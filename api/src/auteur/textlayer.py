"""Text on video: subtitle looks, word-by-word highlighting, and the overlay track for ffmpeg.

The editor draws the same thing in web/src/remotion/TextLayer.tsx; both use the same Montserrat files
and the constants in LOOK below, and both take line breaks from the text itself, so layout matches.

For ffmpeg, every moment where the visible text changes (an item appears, a word starts) becomes
one full-frame transparent PNG, and the PNGs are chained with the concat demuxer into a single
overlay stream, however many words there are.
"""

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from auteur.timeline.models import TextItem, Timeline

FONTS = Path(__file__).resolve().parents[2] / "assets" / "fonts"


@dataclass(frozen=True)
class LookSpec:
    weight: int  # 800 or 900
    size: float  # fraction of output height
    upper: bool
    stroke: float  # fraction of font size
    shadow: bool
    mode: str  # "plain", "karaoke", "box", "reveal"


LOOK = {
    "clean": LookSpec(800, 0.045, False, 0.09, False, "plain"),
    "bold": LookSpec(900, 0.058, True, 0.14, True, "plain"),
    "karaoke": LookSpec(900, 0.058, True, 0.14, True, "karaoke"),
    "box": LookSpec(900, 0.055, True, 0.12, True, "box"),
    "pop": LookSpec(900, 0.064, True, 0.14, True, "reveal"),
}
TITLE = LookSpec(900, 0.08, False, 0.09, True, "plain")
CAPTION = LookSpec(800, 0.035, False, 0.0, False, "plain")
LINE_HEIGHT = 1.18
BOX_PAD = 0.16  # padding of the highlight box, fraction of font size


def spec(item: TextItem) -> LookSpec:
    if item.style == "title":
        return TITLE
    if item.style == "caption":
        return CAPTION
    return LOOK[item.look]


_fonts: dict[tuple[int, int], ImageFont.FreeTypeFont] = {}


def font(weight: int, px: int) -> ImageFont.FreeTypeFont:
    key = (weight, px)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(str(FONTS / f"montserrat-{weight}.ttf"), px)
    return _fonts[key]


def active_word(item: TextItem, t: float) -> int:
    """Index of the word being spoken at timeline time t (the last one that has started), or -1."""
    idx = -1
    for i, w in enumerate(item.words):
        if w.start <= t + 1e-6:
            idx = i
    return idx


def _hex(color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    return int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16), alpha


def draw_item(img: Image.Image, item: TextItem, active: int) -> None:
    W, H = img.size
    sp = spec(item)
    px = max(8, round(H * sp.size))
    f = font(sp.weight, px)
    stroke = round(px * sp.stroke)
    draw = ImageDraw.Draw(img)
    lines = [ln.split() for ln in item.text.split("\n")]
    shown = [w.upper() if sp.upper else w for ln in lines for w in ln]
    space = f.getlength(" ")
    lh = px * LINE_HEIGHT
    top = item.y * H - lh * len(lines) / 2
    accent = _hex(item.color)
    k = 0
    for li, line in enumerate(lines):
        widths = [f.getlength(w.upper() if sp.upper else w) for w in line]
        width = sum(widths) + space * max(0, len(line) - 1)
        x = min(max(item.x * W - width / 2, 0), max(0, W - width))
        cy = top + lh * (li + 0.5)
        if item.style == "caption" and li == 0:
            pad = px / 3
            block_w = max(sum(f.getlength(w) for w in ln) + space * max(0, len(ln) - 1) for ln in lines)
            bx = min(max(item.x * W - block_w / 2, 0), max(0, W - block_w))
            draw.rounded_rectangle((bx - pad, top - pad, bx + block_w + pad, top + lh * len(lines) + pad), radius=pad, fill=(0, 0, 0, 160))
        for w_i, (word, wd) in enumerate(zip(line, widths)):
            text = shown[k]
            spoken = item.words[k] if k < len(item.words) else None
            is_active = k == active
            fill = (255, 255, 255, 255)
            if spoken and spoken.emphasis:
                fill = accent
            if sp.mode == "karaoke" and is_active:
                fill = accent
            if sp.mode == "reveal":
                if item.words and k > active:
                    x += wd + space
                    k += 1
                    continue
                if is_active:
                    fill = accent
            if sp.mode == "box" and is_active:
                pad = px * BOX_PAD
                draw.rounded_rectangle((x - pad, cy - px * 0.62, x + wd + pad, cy + px * 0.62), radius=pad * 1.2, fill=accent)
                draw.text((x, cy), text, font=f, fill=(17, 17, 17, 255), anchor="lm")
            else:
                if sp.shadow:
                    draw.text((x, cy + px * 0.06), text, font=f, fill=(0, 0, 0, 110), anchor="lm", stroke_width=stroke, stroke_fill=(0, 0, 0, 110))
                draw.text((x, cy), text, font=f, fill=fill, anchor="lm", stroke_width=stroke, stroke_fill=(0, 0, 0, 255))
            x += wd + space
            k += 1


def text_track(tl: Timeline, out_w: int, out_h: int, workdir: Path) -> Path | None:
    """Concat-demuxer list of full-frame PNGs covering [0, duration); None when there is no text."""
    duration = tl.duration
    items = [t for t in tl.texts if t.start < duration and t.end > 0]
    if not items:
        return None
    cuts = {0.0, duration}
    for t in items:
        cuts.update({max(0.0, t.start), min(duration, t.end)})
        cuts.update(w.start for w in t.words if t.start < w.start < t.end)
    times = sorted(c for c in cuts if 0 <= c <= duration)

    images: dict[tuple, Path] = {}
    entries: list[tuple[Path, float]] = []
    for a, b in zip(times, times[1:]):
        if b - a < 1e-4:
            continue
        mid = (a + b) / 2
        visible = [t for t in items if t.start <= mid < t.end]
        key = tuple((t.id, active_word(t, mid) if t.words else -1) for t in visible)
        if key not in images:
            img = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
            for t in visible:
                draw_item(img, t, active_word(t, mid) if t.words else -1)
            path = workdir / f"txt_{len(images)}.png"
            img.save(path, compress_level=1)
            images[key] = path
        entries.append((images[key], b - a))

    listing = workdir / "text.txt"
    lines = ["ffconcat version 1.0"]
    for path, dur in entries:
        lines += [f"file '{path}'", f"duration {dur:.4f}"]
    lines.append(f"file '{entries[-1][0]}'")  # the demuxer needs the last file twice to honor its duration
    listing.write_text("\n".join(lines) + "\n")
    return listing
