"""Render a timeline to MP4 with one ffmpeg filter graph.

Per clip: trim the source, apply the grade, crop to the output aspect (following crop keyframes),
scale, and pad the audio with silence when the clip is muted or has none. Clips are concatenated,
then the text track (textlayer.py) is overlaid. Text is rasterized with Pillow rather than ffmpeg's
drawtext, which many ffmpeg builds lack and which can't do word-by-word highlighting.
"""

import re
import subprocess
import tempfile
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from auteur import animate, derived, grade
from auteur.effects import apply_effects
from auteur.textlayer import text_track
from auteur.tracking import Track
from auteur.timeline.models import CropKey, CropRect, Media, OverlayBox, Timeline, Transform, Zoom


class RenderError(RuntimeError):
    pass


class RenderCancelled(RenderError):
    pass


@dataclass(frozen=True)
class Encode:
    """How the output is encoded. The defaults are the agent's renders; exports pick their own."""

    crf: int = 20
    preset: str | None = None  # None: medium, or veryfast for scaled-down previews
    audio_bitrate: str = "160k"
    video_mbps: float | None = None  # a target bitrate instead of constant quality (crf)
    audio_only: bool = False  # MP3 of the mixed soundtrack, no video stream


def _lerp_expr(keys: list[tuple[float, float]], var: str = "t", digits: int = 2) -> str:
    """Piecewise-linear ffmpeg expression of `var` (t, or T in geq) through (time, value) keys."""
    if len(keys) == 1:
        return f"{keys[0][1]:.{digits}f}"
    expr = f"{keys[-1][1]:.{digits}f}"
    for (t0, v0), (t1, v1) in reversed(list(zip(keys, keys[1:]))):
        seg = f"{v0:.{digits}f}+({v1 - v0:.{digits}f})*({var}-{t0:.3f})/{max(t1 - t0, 1e-3):.3f}"
        expr = f"if(lt({var}\\,{t1:.3f})\\,{seg}\\,{expr})"
    return f"if(lt({var}\\,{keys[0][0]:.3f})\\,{keys[0][1]:.{digits}f}\\,{expr})"


def crop_window(m: Media, out_w: int, out_h: int) -> tuple[int, int]:
    """Largest even-sized window of the output aspect inside the source."""
    ar = out_w / out_h
    if m.width / m.height > ar:
        cw, ch = round(m.height * ar), m.height
    else:
        cw, ch = m.width, round(m.width / ar)
    return cw - cw % 2, ch - ch % 2


def crop_filter(m: Media, keys: list[CropKey], out_w: int, out_h: int, zoom: Zoom | None = None, duration: float = 1) -> str:
    """Crop the output aspect from the source around the crop keys, scale to the output size, then
    (for a Ken Burns zoom) scale up over time and crop the center back out. `t` is clip-local."""
    cw, ch = crop_window(m, out_w, out_h)
    keys = keys or [CropKey(t=0, cx=0.5, cy=0.5)]
    xs = [(k.t, min(max(k.cx * m.width - cw / 2, 0), m.width - cw)) for k in keys]
    ys = [(k.t, min(max(k.cy * m.height - ch / 2, 0), m.height - ch)) for k in keys]
    f = f"crop={cw}:{ch}:x='{_lerp_expr(xs)}':y='{_lerp_expr(ys)}',scale={out_w}:{out_h}"
    if zoom:
        f += "," + zoom_filter(zoom, out_w, out_h, duration)
    return f


def zoom_filter(zoom: Zoom, out_w: int, out_h: int, duration: float) -> str:
    """Ken Burns: scale the frame up over the clip and crop the center back out. `t` is clip-local."""
    z = f"({zoom.start:.4f}+({zoom.end - zoom.start:.4f})*min(t/{max(duration, 1e-3):.3f}\\,1))"
    return (f"scale=w='2*trunc({out_w}*{z}/2)':h='2*trunc({out_h}*{z}/2)':eval=frame"
            f",crop={out_w}:{out_h}:(iw-{out_w})/2:(ih-{out_h})/2")


def fit_size(w: int, h: int, out_w: int, out_h: int) -> tuple[int, int]:
    """The whole w x h picture scaled to fit inside the frame (even sizes); fitSize in the preview."""
    s = min(out_w / w, out_h / h)
    return max(2, round(w * s / 2) * 2), max(2, round(h * s / 2) * 2)


def transform_filters(t: Transform, out_w: int, out_h: int) -> list[str]:
    """Flip, scale and rotate the frame about its center, then move it; black where it no longer
    covers. Same order as the preview's CSS `translate() rotate() scale()`."""
    even = lambda v: max(2, round(v / 2) * 2)  # noqa: E731
    f = []
    if t.flip_h:
        f.append("hflip")
    if t.flip_v:
        f.append("vflip")
    if t.scale != 1:
        f.append(f"scale={even(out_w * t.scale)}:{even(out_h * t.scale)}")
    if t.scale != 1 or t.rotation:
        # rotate centers its input in an out_w x out_h frame: crops a bigger frame, pads a smaller one.
        f.append(f"rotate={t.rotation:.4f}*PI/180:ow={out_w}:oh={out_h}:c=black")
    dx, dy = round(t.x * out_w), round(t.y * out_h)
    if dx or dy:
        f.append(
            f"pad=w={out_w + abs(dx)}:h={out_h + abs(dy)}:x={max(dx, 0)}:y={max(dy, 0)}:color=black,"
            f"crop={out_w}:{out_h}:{max(-dx, 0)}:{max(-dy, 0)}"
        )
    return f


def cut_edges(m: Media, rect: CropRect, keys: list[CropKey]) -> tuple[str, Media, list[CropKey]]:
    """The ffmpeg crop that cuts the edges, the source as it looks after it, and the crop keys moved
    into its coordinates (they are stored relative to the whole source)."""
    x, y, w, h = rect.window(m.width, m.height)
    inner = m.model_copy(update={"width": w, "height": h})
    moved = [k.model_copy(update={"cx": min(max((k.cx * m.width - x) / w, 0), 1), "cy": min(max((k.cy * m.height - y) / h, 0), 1)})
             for k in keys]
    return f"crop={w}:{h}:{x}:{y}", inner, moved


# Overlapping transitions -> ffmpeg xfade names; TimelineComposition.tsx draws each the same way.
XFADE = {
    "crossfade": "fade", "slide_left": "slideleft", "slide_right": "slideright", "slide_up": "slideup",
    "slide_down": "slidedown", "wipe_left": "wipeleft", "wipe_right": "wiperight", "circle": "circleopen", "zoom": "zoomin",
}


# Overlay.blend -> ffmpeg blend modes; TimelineComposition.tsx uses the CSS mix-blend-mode of the same name.
BLEND = {"screen": "screen", "multiply": "multiply", "overlay": "overlay", "lighten": "lighten", "darken": "darken", "add": "addition"}


def pose_filters(c, out_w: int, out_h: int) -> list[str]:
    """The clip's transform, keyframes and in/out animations (animate.effective_keys) as filters. A pose
    that never changes uses the plain transform filters; a moving one the same steps driven by `t`."""
    keys = animate.effective_keys(c)
    flips = [f for f, on in (("hflip", c.transform and c.transform.flip_h), ("vflip", c.transform and c.transform.flip_v)) if on]
    if animate.is_static(keys):
        p = keys[0][1]
        static = Transform(x=p.x, y=p.y, scale=p.scale, rotation=max(-180, min(180, p.rotation)),
                           flip_h=bool(c.transform and c.transform.flip_h), flip_v=bool(c.transform and c.transform.flip_v))
        f = [] if static.is_identity else transform_filters(static, out_w, out_h)
        if p.opacity < 1:
            o = f"{p.opacity:.4f}"
            f.append(f"lutyuv=y='val*{o}':u='128+(val-128)*{o}':v='128+(val-128)*{o}'")
        return f
    s = _lerp_expr([(t, p.scale) for t, p in keys], digits=4)
    r = _lerp_expr([(t, p.rotation) for t, p in keys], digits=3)
    dx = _lerp_expr([(t, p.x * out_w) for t, p in keys])
    dy = _lerp_expr([(t, p.y * out_h) for t, p in keys])
    # A canvas big enough for the largest size plus the farthest move, so crop never leaves it.
    pw = round((out_w * max(1, max(p.scale for _, p in keys)) + 2 * max(abs(p.x) * out_w for _, p in keys)) / 2) * 2 + 4
    ph = round((out_h * max(1, max(p.scale for _, p in keys)) + 2 * max(abs(p.y) * out_h for _, p in keys)) / 2) * 2 + 4
    f = [
        *flips,
        f"scale=w='max(2\\,2*trunc({out_w}*({s})/2))':h='max(2\\,2*trunc({out_h}*({s})/2))':eval=frame",
        f"pad=w={pw}:h={ph}:x='(ow-iw)/2':y='(oh-ih)/2':color=black:eval=frame",
        f"rotate='({r})*PI/180':ow={pw}:oh={ph}:c=black",
        f"crop={out_w}:{out_h}:x='({pw}-{out_w})/2-({dx})':y='({ph}-{out_h})/2-({dy})'",
    ]
    if any(p.opacity < 1 for _, p in keys):
        o = _lerp_expr([(t, p.opacity) for t, p in keys], var="T", digits=4)
        f.append(f"geq=lum='lum(X\\,Y)*({o})':cb='128+(cb(X\\,Y)-128)*({o})':cr='128+(cr(X\\,Y)-128)*({o})'")
    return f


LAYOUT_BOX = {  # x, y of the top-left corner as fractions; picture-in-picture is 34% of the width
    "kanan_atas": (0.63, 0.04), "kiri_atas": (0.03, 0.04), "kanan_bawah": (0.63, 0.62), "kiri_bawah": (0.03, 0.62),
}
PIP_SCALE = 0.34


def overlay_rect(layout: str, out_w: int, out_h: int, box: OverlayBox | None = None) -> tuple[int, int, int, int]:
    """x, y, w, h of a B-roll overlay in output pixels (same numbers as the editor preview, overlayRect)."""
    if box is not None:
        w, h = max(2, round(out_w * box.scale / 2) * 2), max(2, round(out_h * box.scale / 2) * 2)
        return round(out_w * box.x - w / 2), round(out_h * box.y - h / 2), w, h
    if layout == "full":
        return 0, 0, out_w, out_h
    w, h = round(out_w * PIP_SCALE / 2) * 2, round(out_h * PIP_SCALE / 2) * 2
    fx, fy = LAYOUT_BOX[layout]
    return round(out_w * fx), round(out_h * fy), w, h


def letterbox_bar(out_w: int, out_h: int, ratio: float | None) -> int:
    """Height of each cinema bar; 0 when the frame is already that wide."""
    if not ratio:
        return 0
    return max(0, round((out_h - out_w / ratio) / 2))


def build_command(
    tl: Timeline, media: dict[str, Media], out: Path, workdir: Path, scale: float = 1.0,
    video_override: dict[str, Path] | None = None, encode: Encode = Encode(),
) -> list[str]:
    """`video_override` maps clip id -> pre-rendered video of exactly that clip's source range."""
    if not tl.clips:
        raise RenderError("Timeline is empty")
    out_w, out_h = (round(v * scale / 2) * 2 for v in tl.size)
    fps = tl.fps
    video_override = video_override or {}
    starts = tl.clip_starts()

    inputs: list[list[str]] = []  # ffmpeg input options per input index

    def add_input(opts: list[str]) -> int:
        if opts not in inputs:
            inputs.append(opts)
        return inputs.index(opts)

    def media_input(path: Path) -> int:
        return add_input(["-i", str(path.resolve())])

    chains: list[str] = []
    for i, c in enumerate(tl.clips):
        m = media[c.media_id]
        if c.reverse:
            # Backwards: trim the reversed copy at mirrored times (sound comes from it too).
            src = media_input(derived.reversed_source(Path(m.path).parent, m))
            a_in, a_out = derived.mirrored(c, m)
        else:
            src = media_input(Path(m.path))
            a_in, a_out = c.src_in, c.src_out
        if c.id in video_override:
            vsrc, start, end = media_input(video_override[c.id]), 0.0, c.src_duration
        else:
            vsrc, start, end = src, a_in, a_out
        nxt = tl.clips[i + 1] if i + 1 < len(tl.clips) else None
        dip_in = c.transition if c.transition and not c.transition.overlaps else None
        dip_out = nxt.transition if nxt and nxt.transition and not nxt.transition.overlaps else None
        tone = grade.ffmpeg_filters(c.grade, grade.write_cube(c.grade, workdir / f"grade_{i}.cube"))
        if c.lut:
            lut = Path(m.path).resolve().parents[2] / "luts" / f"{c.lut.lut_id}.cube"  # <project>/media/<id>/source.*
            if not lut.exists():
                raise RenderError(f"LUT {c.lut.lut_id!r} of clip {c.id!r} is missing")
            # The LUT comes before the grade, at its intensity (blended into the table).
            tone = [f"lut3d=file='{derived.scaled_lut(lut, c.lut.intensity, workdir / f'lut_{i}.cube')}'", *tone]
        edges, framed, keys = cut_edges(m, c.crop_rect, c.crop) if c.crop_rect else (None, m, c.crop)
        pre = [f"trim=start={start}:end={end}", f"setpts=(PTS-STARTPTS)/{c.speed}", f"fps={fps}", *tone, *([edges] if edges else [])]
        after = [*pose_filters(c, out_w, out_h), "setsar=1"]
        if c.fit == "fit":
            # The whole picture over a backdrop: the clip itself filled and blurred, or a flat color.
            fw, fh = fit_size(framed.width, framed.height, out_w, out_h)
            bd = c.backdrop
            back = f"gblur=sigma={bd.blur * out_h:.2f}" if bd.kind == "blur" else f"drawbox=c={bd.color}:t=fill"
            chains.append(f"[{vsrc}:v]{','.join(pre)},split[fs{i}][fb{i}]")
            chains.append(f"[fb{i}]{crop_filter(framed, [], out_w, out_h)},{back}[bg{i}]")
            chains.append(f"[fs{i}]scale={fw}:{fh}[fg{i}]")
            chains.append(f"[bg{i}][fg{i}]overlay={(out_w - fw) // 2}:{(out_h - fh) // 2}[base{i}]")
            head = f"[base{i}]"
            v = [*([zoom_filter(c.zoom, out_w, out_h, c.duration)] if c.zoom else []), *after]
        else:
            head = f"[{vsrc}:v]"
            v = [*pre, crop_filter(framed, keys, out_w, out_h, c.zoom, c.duration), *after]
        # A dip fades this clip out to the color and the next one in from it, half the duration each.
        if dip_in:
            v.append(f"fade=t=in:d={dip_in.duration / 2:.3f}:color={'black' if dip_in.kind == 'dip_black' else 'white'}")
        if dip_out:
            d = dip_out.duration / 2
            v.append(f"fade=t=out:st={max(c.duration - d, 0):.3f}:d={d:.3f}:color={'black' if dip_out.kind == 'dip_black' else 'white'}")
        if c.grade.vignette > 0:
            # Multiply by the same radial mask the preview draws (grade.vignette_factor).
            mask = grade.write_vignette_mask(c.grade, out_w, out_h, workdir / f"vignette_{i}.png")
            mi = add_input(["-loop", "1", "-framerate", str(fps), "-t", f"{c.duration:.3f}", "-i", str(mask)])
            chains.append(f"{head}{','.join(v)},format=gbrp[pre{i}]")
            chains.append(f"[{mi}:v]format=gbrp[vm{i}]")
            chains.append(f"[pre{i}][vm{i}]blend=all_mode=multiply:shortest=1,format=yuv420p[v{i}]")
        else:
            chains.append(f"{head}{','.join(v)},format=yuv420p[v{i}]")

        if m.has_audio and c.has_sound:
            # The longest of: the clip's own fade, half a dip, or 20 ms against clicks at the cut.
            fade_in = max(c.audio_fade_in, dip_in.duration / 2 if dip_in else 0.02)
            fade_out = max(c.audio_fade_out, dip_out.duration / 2 if dip_out else 0.02)
            a = [
                f"atrim=start={a_in}:end={a_out}", "asetpts=PTS-STARTPTS",
                "aresample=48000", "aformat=channel_layouts=stereo",
                (f"volume='{c.volume:.3f}*({_lerp_expr([(k.t, k.v) for k in c.volume_keys])})':eval=frame"
                 if c.volume_keys else f"volume={c.volume:.3f}"),
                f"afade=t=in:d={fade_in:.3f}",
                f"afade=t=out:st={max(c.duration - fade_out, 0):.3f}:d={fade_out:.3f}",
            ]
            chains.append(f"[{src}:a]{','.join(a)}[a{i}]")
        else:
            chains.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={c.duration:.3f}[a{i}]")

    # Join clips in order: crossfades overlap (xfade/acrossfade), everything else is a straight cut.
    vacc, aacc = "v0", "a0"
    for i in range(1, len(tl.clips)):
        tr = tl.clips[i].transition
        if tr and tr.overlaps:
            chains.append(
                f"[{vacc}][v{i}]xfade=transition={XFADE[tr.kind]}:duration={tr.duration:.3f}:offset={starts[i]:.3f}[vj{i}]"
            )
            chains.append(f"[{aacc}][a{i}]acrossfade=d={tr.duration:.3f}[aj{i}]")
        else:
            chains.append(f"[{vacc}][v{i}]concat=n=2:v=1:a=0[vj{i}]")
            chains.append(f"[{aacc}][a{i}]concat=n=2:v=0:a=1[aj{i}]")
        vacc, aacc = f"vj{i}", f"aj{i}"

    # B-roll on the second track.
    for j, o in enumerate(tl.overlays):
        if o.start >= tl.duration:
            continue
        m = media[o.media_id]
        oi = media_input(Path(m.path))
        x, y, w, h = overlay_rect(o.layout, out_w, out_h, o.box)
        tone = grade.ffmpeg_filters(o.grade, grade.write_cube(o.grade, workdir / f"broll_{j}.cube"))
        end = min(o.end, tl.duration)
        picture = f"trim=start={o.src_in}:end={o.src_out},setpts=PTS-STARTPTS,fps={fps},{','.join([*tone, crop_filter(m, [], w, h)])},setsar=1"
        if o.blend == "normal":
            alpha = f",format=yuva420p,colorchannelmixer=aa={o.opacity:.3f}" if o.opacity < 1 else ",format=yuv420p"
            chains.append(f"[{oi}:v]{picture},setpts=PTS+{o.start:.3f}/TB{alpha}[ov{j}]")
            chains.append(
                f"[{vacc}][ov{j}]overlay=x={x}:y={y}:enable='between(t,{o.start:.3f},{end:.3f})':eof_action=pass[vo{j}]"
            )
        else:
            # Blend modes mix in RGB (as CSS mix-blend-mode does) over the part of the frame the B-roll covers.
            # The B-roll is padded in time to start at 0, so both blend inputs line up frame for frame.
            x0, y0 = max(x, 0), max(y, 0)
            x1, y1 = min(x + w, out_w), min(y + h, out_h)
            if x1 - x0 < 2 or y1 - y0 < 2:
                continue  # entirely off screen
            cw, ch = x1 - x0, y1 - y0
            chains.append(
                f"[{oi}:v]{picture},crop={cw}:{ch}:{x0 - x}:{y0 - y},tpad=start_duration={o.start:.3f}:color=black,format=gbrp[ov{j}]"
            )
            chains.append(f"[{vacc}]split[vb{j}][vr{j}]")
            chains.append(f"[vr{j}]crop={cw}:{ch}:{x0}:{y0},format=gbrp[reg{j}]")
            chains.append(
                f"[ov{j}][reg{j}]blend=all_mode={BLEND[o.blend]}:all_opacity={o.opacity:.3f},format=yuv420p[mix{j}]"
            )
            chains.append(
                f"[vb{j}][mix{j}]overlay=x={x0}:y={y0}:enable='between(t,{o.start:.3f},{end:.3f})':eof_action=pass[vo{j}]"
            )
        vacc = f"vo{j}"

    # Finishing: cinema bars and film grain, under the text.
    finish = []
    bar = letterbox_bar(out_w, out_h, tl.finish.letterbox)
    if bar:
        finish += [f"drawbox=x=0:y=0:w=iw:h={bar}:color=black:t=fill", f"drawbox=x=0:y=ih-{bar}:w=iw:h={bar}:color=black:t=fill"]
    if tl.finish.grain > 0:
        finish.append(f"noise=alls={round(4 + 22 * tl.finish.grain)}:allf=t")
    if finish:
        chains.append(f"[{vacc}]{','.join(finish)}[vf]")
        vacc = "vf"

    track = None if encode.audio_only else text_track(tl, out_w, out_h, workdir)
    if track is not None:
        ti = add_input(["-f", "concat", "-safe", "0", "-i", str(track)])
        chains.append(f"[{ti}:v]fps={fps},format=rgba[txt]")
        chains.append(f"[{vacc}][txt]overlay=format=auto:eof_action=pass[vt]")
        vacc = "vt"

    # Music: trimmed, faded, placed, then ducked under the speech with a sidechain compressor.
    music = []
    for k, a in enumerate(tl.audio):
        if a.start >= tl.duration:
            continue
        mi = media_input(Path(media[a.media_id].path))
        length = min(a.duration, tl.duration - a.start)
        delay = round(a.start * 1000)
        chains.append(
            f"[{mi}:a]atrim=start={a.src_in}:end={a.src_in + length:.3f},asetpts=PTS-STARTPTS,"
            f"aresample=48000,aformat=channel_layouts=stereo,volume={a.volume:.3f},"
            f"afade=t=in:d={min(a.fade_in, length / 2):.3f},"
            f"afade=t=out:st={max(length - a.fade_out, 0):.3f}:d={min(a.fade_out, length):.3f},"
            f"adelay={delay}|{delay}[m{k}]"
        )
        music.append((k, a.duck))
    if music:
        ducked = [f"[m{k}]" for k, duck in music if duck]
        plain = [f"[m{k}]" for k, duck in music if not duck]
        parts = [f"[{aacc}]"]
        if ducked:
            chains.append(f"[{aacc}]asplit=2[voice][sc]")
            src = ducked[0]
            if len(ducked) > 1:
                chains.append(f"{''.join(ducked)}amix=inputs={len(ducked)}:normalize=0[mduckin]")
                src = "[mduckin]"
            chains.append(f"{src}[sc]sidechaincompress=threshold=0.02:ratio=8:attack=30:release=400[mduck]")
            parts = ["[voice]", "[mduck]"]
        parts += plain
        chains.append(f"{''.join(parts)}amix=inputs={len(parts)}:duration=first:normalize=0[amixed]")
        aacc = "amixed"

    args = ["ffmpeg", "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats"]
    for opts in inputs:
        args += opts
    if encode.audio_only:
        # The video chain still has to end somewhere; the soundtrack is what gets written.
        chains.append(f"[{vacc}]nullsink")
        return args + [
            "-filter_complex", ";".join(chains), "-map", f"[{aacc}]",
            "-c:a", "libmp3lame", "-b:a", encode.audio_bitrate, "-t", f"{tl.duration:.3f}", str(out),
        ]
    preset = encode.preset or ("veryfast" if scale < 1 else "medium")
    args += [
        "-filter_complex", ";".join(chains), "-map", f"[{vacc}]", "-map", f"[{aacc}]",
        "-c:v", "libx264", "-preset", preset,
        *(["-b:v", f"{encode.video_mbps:g}M", "-maxrate", f"{encode.video_mbps * 1.5:g}M", "-bufsize", f"{encode.video_mbps * 2:g}M"]
          if encode.video_mbps else ["-crf", str(encode.crf)]),
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", encode.audio_bitrate, "-movflags", "+faststart", "-t", f"{tl.duration:.3f}", str(out),
    ]
    return args


def render(
    tl: Timeline, media: dict[str, Media], out: Path, scale: float = 1.0,
    on_progress: Callable[[float], None] | None = None,
    tracks: dict[str, Track] | None = None,
    encode: Encode = Encode(),
    cancel: threading.Event | None = None,
) -> Path:
    """Render synchronously; `on_progress` gets 0..1. Run it in a thread from async code.

    `tracks` holds every track referenced by clip effects; clips with effects get an OpenCV pass first.
    Setting `cancel` kills ffmpeg and raises RenderCancelled; the partial file is removed.
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as workdir:
        overrides = {} if encode.audio_only else {
            c.id: apply_effects(c, media[c.media_id], tracks or {}, Path(workdir) / f"fx_{c.id}.mp4")
            for c in tl.clips
            if c.effects
        }
        if cancel and cancel.is_set():
            raise RenderCancelled("Cancelled")
        cmd = build_command(tl, media, out, Path(workdir), scale, overrides, encode)
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert proc.stdout is not None and proc.stderr is not None
        # Drain stderr on the side, so a chatty ffmpeg can't block on a full pipe.
        errors: list[str] = []
        drain = threading.Thread(target=lambda: errors.append(proc.stderr.read()), daemon=True)
        drain.start()
        for line in proc.stdout:
            if cancel and cancel.is_set():
                proc.kill()
                break
            if on_progress and (m := re.match(r"out_time_us=(\d+)", line)):
                on_progress(min(int(m.group(1)) / 1e6 / max(tl.duration, 1e-3), 1.0))
        code = proc.wait()
        drain.join(timeout=5)
        if cancel and cancel.is_set():
            out.unlink(missing_ok=True)
            raise RenderCancelled("Cancelled")
        if code != 0:
            raise RenderError("".join(errors).strip()[-800:] or "ffmpeg failed")
    return out
