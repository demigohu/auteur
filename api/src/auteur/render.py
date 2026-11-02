"""Render a timeline to MP4 with one ffmpeg filter graph.

Per clip: trim the source, apply the grade, crop to the output aspect (following crop keyframes),
scale, and pad the audio with silence when the clip is muted or has none. Clips are concatenated,
then text items are drawn on top. Text is rasterized with Pillow and overlaid as PNGs because ffmpeg
builds without libfreetype/libass (including the one in this dev setup) have no drawtext.
"""

import re
import subprocess
import tempfile
import textwrap
from collections.abc import Callable
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from auteur.config import settings
from auteur.effects import apply_effects
from auteur.tracking import Track
from auteur.timeline.models import Clip, CropKey, Grade, Media, TextItem, Timeline

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
]
TEXT_SIZE = {"subtitle": 0.045, "title": 0.08, "caption": 0.035}  # fraction of output height


class RenderError(RuntimeError):
    pass


def font_path() -> str:
    for p in [settings.font_path, *FONT_CANDIDATES]:
        if p and Path(p).exists():
            return p
    raise RenderError("No font found; set FONT_PATH")


def grade_filters(g: Grade) -> list[str]:
    out = []
    if g.exposure or g.contrast or g.saturation:
        out.append(
            f"eq=brightness={g.exposure * 0.1:.4f}:gamma={2 ** (g.exposure * 0.5):.4f}"
            f":contrast={1 + g.contrast * 0.5:.4f}:saturation={1 + g.saturation:.4f}"
        )
    if g.temperature:
        # colortemperature: lower Kelvin renders warmer.
        out.append(f"colortemperature=temperature={6500 - g.temperature * 3000:.0f}:pl=1")
    if g.tint:
        out.append(f"colorbalance=gm={-g.tint * 0.3:.4f}")
    return out


def _lerp_expr(keys: list[tuple[float, float]]) -> str:
    """Piecewise-linear ffmpeg expression of `t` through (time, value) keys."""
    if len(keys) == 1:
        return f"{keys[0][1]:.2f}"
    expr = f"{keys[-1][1]:.2f}"
    for (t0, v0), (t1, v1) in reversed(list(zip(keys, keys[1:]))):
        seg = f"{v0:.2f}+({v1 - v0:.2f})*(t-{t0:.3f})/{max(t1 - t0, 1e-3):.3f}"
        expr = f"if(lt(t\\,{t1:.3f})\\,{seg}\\,{expr})"
    return f"if(lt(t\\,{keys[0][0]:.3f})\\,{keys[0][1]:.2f}\\,{expr})"


def crop_filter(m: Media, keys: list[CropKey], out_w: int, out_h: int) -> str:
    """Largest window of the output aspect inside the source, centered on the crop keys."""
    ar = out_w / out_h
    if m.width / m.height > ar:
        cw, ch = round(m.height * ar), m.height
    else:
        cw, ch = m.width, round(m.width / ar)
    cw, ch = cw - cw % 2, ch - ch % 2
    keys = keys or [CropKey(t=0, cx=0.5, cy=0.5)]
    xs = [(k.t, min(max(k.cx * m.width - cw / 2, 0), m.width - cw)) for k in keys]
    ys = [(k.t, min(max(k.cy * m.height - ch / 2, 0), m.height - ch)) for k in keys]
    return f"crop={cw}:{ch}:x='{_lerp_expr(xs)}':y='{_lerp_expr(ys)}',scale={out_w}:{out_h}"


def text_png(item: TextItem, out_w: int, out_h: int, path: Path) -> None:
    size = round(out_h * TEXT_SIZE[item.style])
    font = ImageFont.truetype(font_path(), size)
    chars_per_line = max(8, int(out_w * 0.85 / (size * 0.55)))
    text = "\n".join(textwrap.wrap(item.text, chars_per_line, break_on_hyphens=False)) or item.text
    img = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    box = draw.multiline_textbbox((0, 0), text, font=font, align="center", stroke_width=max(2, size // 12))
    w, h = box[2] - box[0], box[3] - box[1]
    x = min(max(item.x * out_w - w / 2, 0), out_w - w)
    y = min(max(item.y * out_h - h / 2, 0), out_h - h)
    if item.style == "caption":
        pad = size // 3
        draw.rounded_rectangle((x - pad, y - pad, x + w + pad, y + h + pad), radius=pad, fill=(0, 0, 0, 160))
        draw.multiline_text((x, y - box[1]), text, font=font, fill="white", align="center")
    else:
        draw.multiline_text(
            (x, y - box[1]), text, font=font, fill="white", align="center",
            stroke_width=max(2, size // 12), stroke_fill="black",
        )
    img.save(path)


def build_command(
    tl: Timeline, media: dict[str, Media], out: Path, workdir: Path, scale: float = 1.0,
    video_override: dict[str, Path] | None = None,
) -> list[str]:
    """`video_override` maps clip id -> pre-rendered video of exactly that clip (effects pass)."""
    if not tl.clips:
        raise RenderError("Timeline is empty")
    out_w, out_h = (round(v * scale / 2) * 2 for v in tl.size)
    fps = tl.fps
    video_override = video_override or {}

    inputs: list[str] = []

    def input_index(path: Path) -> int:
        p = str(path.resolve())
        if p not in inputs:
            inputs.append(p)
        return inputs.index(p)

    chains, concat_in = [], []
    for i, c in enumerate(tl.clips):
        m = media[c.media_id]
        src = input_index(Path(m.path))
        if c.id in video_override:
            vsrc, start, end = input_index(video_override[c.id]), 0.0, c.duration
        else:
            vsrc, start, end = src, c.src_in, c.src_out
        v = [
            f"trim=start={start}:end={end}", "setpts=PTS-STARTPTS", f"fps={fps}",
            *grade_filters(c.grade), crop_filter(m, c.crop, out_w, out_h), "setsar=1", "format=yuv420p",
        ]
        chains.append(f"[{vsrc}:v]{','.join(v)}[v{i}]")
        if m.has_audio and not c.muted:
            chains.append(
                f"[{src}:a]atrim=start={c.src_in}:end={c.src_out},asetpts=PTS-STARTPTS,"
                f"aresample=48000,aformat=channel_layouts=stereo,afade=t=in:d=0.02,"
                f"afade=t=out:st={max(c.duration - 0.02, 0):.3f}:d=0.02[a{i}]"
            )
        else:
            chains.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={c.duration:.3f}[a{i}]")
        concat_in.append(f"[v{i}][a{i}]")
    chains.append(f"{''.join(concat_in)}concat=n={len(tl.clips)}:v=1:a=1[base][aout]")

    args = ["ffmpeg", "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats"]
    for path in inputs:
        args += ["-i", path]

    last = "base"
    for j, item in enumerate(t for t in tl.texts if t.start < tl.duration):
        png = workdir / f"text_{j}.png"
        text_png(item, out_w, out_h, png)
        args += ["-loop", "1", "-framerate", str(fps), "-t", f"{tl.duration:.3f}", "-i", str(png)]
        idx = len(inputs) + j
        chains.append(f"[{last}][{idx}:v]overlay=enable='between(t,{item.start:.3f},{item.end:.3f})':shortest=1[t{j}]")
        last = f"t{j}"

    args += [
        "-filter_complex", ";".join(chains), "-map", f"[{last}]", "-map", "[aout]",
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
