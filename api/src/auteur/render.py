"""Render a timeline to MP4 with one ffmpeg filter graph.

Per clip: trim the source, apply the grade, crop to the output aspect (following crop keyframes),
scale, and pad the audio with silence when the clip is muted or has none. Clips are concatenated,
then the text track (textlayer.py) is overlaid. Text is rasterized with Pillow rather than ffmpeg's
drawtext, which many ffmpeg builds lack and which can't do word-by-word highlighting.
"""

import re
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

from auteur import grade
from auteur.effects import apply_effects
from auteur.textlayer import text_track
from auteur.tracking import Track
from auteur.timeline.models import CropKey, Media, Timeline, Zoom


class RenderError(RuntimeError):
    pass


def _lerp_expr(keys: list[tuple[float, float]]) -> str:
    """Piecewise-linear ffmpeg expression of `t` through (time, value) keys."""
    if len(keys) == 1:
        return f"{keys[0][1]:.2f}"
    expr = f"{keys[-1][1]:.2f}"
    for (t0, v0), (t1, v1) in reversed(list(zip(keys, keys[1:]))):
        seg = f"{v0:.2f}+({v1 - v0:.2f})*(t-{t0:.3f})/{max(t1 - t0, 1e-3):.3f}"
        expr = f"if(lt(t\\,{t1:.3f})\\,{seg}\\,{expr})"
    return f"if(lt(t\\,{keys[0][0]:.3f})\\,{keys[0][1]:.2f}\\,{expr})"


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
        z = f"({zoom.start:.4f}+({zoom.end - zoom.start:.4f})*min(t/{max(duration, 1e-3):.3f}\\,1))"
        f += (f",scale=w='2*trunc({out_w}*{z}/2)':h='2*trunc({out_h}*{z}/2)':eval=frame"
              f",crop={out_w}:{out_h}:(iw-{out_w})/2:(ih-{out_h})/2")
    return f


LAYOUT_BOX = {  # x, y of the top-left corner as fractions; picture-in-picture is 34% of the width
    "kanan_atas": (0.63, 0.04), "kiri_atas": (0.03, 0.04), "kanan_bawah": (0.63, 0.62), "kiri_bawah": (0.03, 0.62),
}
PIP_SCALE = 0.34


def overlay_rect(layout: str, out_w: int, out_h: int) -> tuple[int, int, int, int]:
    """x, y, w, h of a B-roll overlay in output pixels (same numbers as the editor preview)."""
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
    video_override: dict[str, Path] | None = None,
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
        src = media_input(Path(m.path))
        if c.id in video_override:
            vsrc, start, end = media_input(video_override[c.id]), 0.0, c.src_duration
        else:
            vsrc, start, end = src, c.src_in, c.src_out
        nxt = tl.clips[i + 1] if i + 1 < len(tl.clips) else None
        dip_in = c.transition if c.transition and c.transition.kind != "crossfade" else None
        dip_out = nxt.transition if nxt and nxt.transition and nxt.transition.kind != "crossfade" else None
        tone = grade.ffmpeg_filters(c.grade, grade.write_cube(c.grade, workdir / f"grade_{i}.cube"))
        v = [
            f"trim=start={start}:end={end}", f"setpts=(PTS-STARTPTS)/{c.speed}", f"fps={fps}",
            *tone, crop_filter(m, c.crop, out_w, out_h, c.zoom, c.duration), "setsar=1",
        ]
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
            chains.append(f"[{vsrc}:v]{','.join(v)},format=gbrp[pre{i}]")
            chains.append(f"[{mi}:v]format=gbrp[vm{i}]")
            chains.append(f"[pre{i}][vm{i}]blend=all_mode=multiply:shortest=1,format=yuv420p[v{i}]")
        else:
            chains.append(f"[{vsrc}:v]{','.join(v)},format=yuv420p[v{i}]")

        if m.has_audio and c.has_sound:
            a = [
                f"atrim=start={c.src_in}:end={c.src_out}", "asetpts=PTS-STARTPTS",
                "aresample=48000", "aformat=channel_layouts=stereo",
                (f"volume='{c.volume:.3f}*({_lerp_expr([(k.t, k.v) for k in c.volume_keys])})':eval=frame"
                 if c.volume_keys else f"volume={c.volume:.3f}"),
                f"afade=t=in:d={dip_in.duration / 2 if dip_in else 0.02:.3f}",
                f"afade=t=out:st={max(c.duration - (dip_out.duration / 2 if dip_out else 0.02), 0):.3f}"
                f":d={dip_out.duration / 2 if dip_out else 0.02:.3f}",
            ]
            chains.append(f"[{src}:a]{','.join(a)}[a{i}]")
        else:
            chains.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={c.duration:.3f}[a{i}]")

    # Join clips in order: crossfades overlap (xfade/acrossfade), everything else is a straight cut.
    vacc, aacc = "v0", "a0"
    for i in range(1, len(tl.clips)):
        tr = tl.clips[i].transition
        if tr and tr.kind == "crossfade":
            chains.append(f"[{vacc}][v{i}]xfade=transition=fade:duration={tr.duration:.3f}:offset={starts[i]:.3f}[vj{i}]")
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
        x, y, w, h = overlay_rect(o.layout, out_w, out_h)
        tone = grade.ffmpeg_filters(o.grade, grade.write_cube(o.grade, workdir / f"broll_{j}.cube"))
        chains.append(
            f"[{oi}:v]trim=start={o.src_in}:end={o.src_out},setpts=PTS-STARTPTS+{o.start:.3f}/TB,fps={fps},"
            f"{','.join([*tone, crop_filter(m, [], w, h)])},setsar=1,format=yuv420p[ov{j}]"
        )
        chains.append(
            f"[{vacc}][ov{j}]overlay=x={x}:y={y}:enable='between(t,{o.start:.3f},{min(o.end, tl.duration):.3f})'"
            f":eof_action=pass[vo{j}]"
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

    track = text_track(tl, out_w, out_h, workdir)
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
    args += [
        "-filter_complex", ";".join(chains), "-map", f"[{vacc}]", "-map", f"[{aacc}]",
        "-c:v", "libx264", "-preset", "veryfast" if scale < 1 else "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-t", f"{tl.duration:.3f}", str(out),
    ]
    return args


def render(
    tl: Timeline, media: dict[str, Media], out: Path, scale: float = 1.0,
    on_progress: Callable[[float], None] | None = None,
    tracks: dict[str, Track] | None = None,
) -> Path:
    """Render synchronously; `on_progress` gets 0..1. Run it in a thread from async code.

    `tracks` holds every track referenced by clip effects; clips with effects get an OpenCV pass first.
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as workdir:
        overrides = {
            c.id: apply_effects(c, media[c.media_id], tracks or {}, Path(workdir) / f"fx_{c.id}.mp4")
            for c in tl.clips
            if c.effects
        }
        cmd = build_command(tl, media, out, Path(workdir), scale, overrides)
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert proc.stdout is not None
        for line in proc.stdout:
            if on_progress and (m := re.match(r"out_time_us=(\d+)", line)):
                on_progress(min(int(m.group(1)) / 1e6 / max(tl.duration, 1e-3), 1.0))
        err = proc.stderr.read() if proc.stderr else ""
        if proc.wait() != 0:
            raise RenderError(err.strip()[-800:] or "ffmpeg failed")
    return out
