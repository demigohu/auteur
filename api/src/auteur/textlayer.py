"""Text on video: subtitle looks, word-by-word highlighting, and the overlay track for ffmpeg.

The editor draws the same thing in web/src/remotion/TextLayer.tsx; both use the same font files
(assets/fonts, copied to web/public/fonts) and the constants in LOOK below, and both take line breaks
from the text itself, so layout matches. A text's own style fields (font, colors, size, outline, shadow,
background) override its look.

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


# One file per font; Montserrat keeps the look's weight (800 or 900).
FONT_FILES = {
    "anton": "Anton-Regular.ttf", "bebas": "BebasNeue-Regular.ttf", "poppins": "Poppins-Bold.ttf",
    "dmserif": "DMSerifDisplay-Regular.ttf", "instrument": "InstrumentSerif-Regular.ttf",
    "marker": "PermanentMarker-Regular.ttf", "mono": "SpaceMono-Bold.ttf",
}

_fonts: dict[tuple[str, int, int], ImageFont.FreeTypeFont] = {}


def font(weight: int, px: int, name: str = "montserrat") -> ImageFont.FreeTypeFont:
    key = (name, weight, px)
    if key not in _fonts:
        file = FONT_FILES.get(name) or f"montserrat-{weight}.ttf"
        _fonts[key] = ImageFont.truetype(str(FONTS / file), px)
    return _fonts[key]


@dataclass(frozen=True)
class Style:
    """A text's look with its own overrides applied."""

    spec: LookSpec
    px: int
    stroke: int
    shadow: bool
    font: ImageFont.FreeTypeFont


def style(item: TextItem, H: int) -> Style:
    sp = spec(item)
    px = max(8, round(H * (item.size if item.size is not None else sp.size)))
    stroke = round(px * (item.outline if item.outline is not None else sp.stroke))
    return Style(sp, px, stroke, item.shadow if item.shadow is not None else sp.shadow, font(sp.weight, px, item.font))


def active_word(item: TextItem, t: float) -> int:
    """Index of the word being spoken at timeline time t (the last one that has started), or -1."""
    idx = -1
    for i, w in enumerate(item.words):
        if w.start <= t + 1e-6:
            idx = i
    return idx


def _hex(color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    return int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16), alpha


@dataclass(frozen=True)
class TextState:
    """A text's entrance/exit at a moment: TextLayer.tsx textState computes the same."""

    alpha: float = 1.0
    scale: float = 1.0
    rise: float = 0.0  # downward offset, fraction of the frame height
    words: int | None = None  # words shown, for the word-by-word reveal

    @property
    def moving(self) -> bool:
        return self != TextState()


def text_state(item: TextItem, t: float) -> TextState:
    """Ease out entering (1 - (1-u)^3), ease in leaving: the same curves as clip animations."""
    span = item.end - item.start
    a_in = min(item.anim_in.duration, span / 2) if item.anim_in else 0.0
    a_out = min(item.anim_out.duration, span / 2) if item.anim_out else 0.0
    local = t - item.start
    if item.anim_in and local < a_in:
        anim, u = item.anim_in, max(local, 0) / a_in
        e = 1 - (1 - u) ** 3
    elif item.anim_out and local > span - a_out:
        anim, u = item.anim_out, min(span - local, a_out) / a_out
        e = 1 - (1 - u) ** 3
    else:
        return TextState()
    n = len(item.text.split())
    match anim.kind:
        case "fade":
            return TextState(alpha=e)
        case "pop":
            return TextState(alpha=e, scale=0.6 + 0.4 * e)
        case "slide_up":
            return TextState(alpha=e, rise=0.06 * (1 - e))
        case "words":
            return TextState(words=min(n, int(u * n) + 1) if u < 1 else n)
    return TextState()


def anim_windows(item: TextItem) -> list[tuple[float, float]]:
    span = item.end - item.start
    out = []
    if item.anim_in:
        out.append((item.start, item.start + min(item.anim_in.duration, span / 2)))
    if item.anim_out:
        out.append((item.end - min(item.anim_out.duration, span / 2), item.end))
    return out


def draw_item(img: Image.Image, item: TextItem, active: int, state: TextState = TextState()) -> None:
    """Draw the text; a moving state (entrance/exit) draws on its own layer, then fades, scales and moves it."""
    if state.moving and (state.alpha < 1 or state.scale != 1 or state.rise):
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        _draw(layer, item, active, state.words)
        if state.scale != 1:
            W, H = img.size
            cx, cy = item.x * W, item.y * H
            box = layer.getbbox()
            if box:
                part = layer.crop(box)
                w, h = max(1, round(part.width * state.scale)), max(1, round(part.height * state.scale))
                part = part.resize((w, h), Image.BILINEAR)
                layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
                layer.paste(part, (round(cx + (box[0] - cx) * state.scale), round(cy + (box[1] - cy) * state.scale)))
        if state.alpha < 1:
            alpha = layer.getchannel("A").point(lambda v: round(v * state.alpha))
            layer.putalpha(alpha)
        img.alpha_composite(layer, (0, round(state.rise * img.size[1])))
        return
    _draw(img, item, active, state.words)


def _draw(img: Image.Image, item: TextItem, active: int, words: int | None = None) -> None:
    W, H = img.size
    st = style(item, H)
    sp, px, f, stroke = st.spec, st.px, st.font, st.stroke
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
        if (item.background or item.style == "caption") and li == 0:
            pad = px / 3
            block_w = max(
                sum(f.getlength(w.upper() if sp.upper else w) for w in ln) + space * max(0, len(ln) - 1) for ln in lines
            )
            bx = min(max(item.x * W - block_w / 2, 0), max(0, W - block_w))
            fill_bg = _hex(item.background, round(255 * item.background_opacity)) if item.background else (0, 0, 0, 160)
            draw.rounded_rectangle((bx - pad, top - pad, bx + block_w + pad, top + lh * len(lines) + pad), radius=pad, fill=fill_bg)
        for w_i, (word, wd) in enumerate(zip(line, widths)):
            if words is not None and k >= words:
                # Not revealed yet: keep its place, as the preview's hidden words do.
                x += wd + space
                k += 1
                continue
            text = shown[k]
            spoken = item.words[k] if k < len(item.words) else None
            is_active = k == active
            fill = _hex(item.text_color)
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
                if st.shadow:
                    draw.text((x, cy + px * 0.06), text, font=f, fill=(0, 0, 0, 110), anchor="lm", stroke_width=stroke, stroke_fill=(0, 0, 0, 110))
                draw.text((x, cy), text, font=f, fill=fill, anchor="lm", stroke_width=stroke, stroke_fill=_hex(item.outline_color))
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
        for a, b in anim_windows(t):
            cuts.update({max(0.0, a), min(duration, b)})
    times = sorted(c for c in cuts if 0 <= c <= duration)

    images: dict[tuple, Path] = {}
    entries: list[tuple[Path, float]] = []
    step = 1 / tl.fps

    def frame(at: float, length: float) -> None:
        visible = [t for t in items if t.start <= at < t.end]
        states = [text_state(t, at) for t in visible]
        key = tuple((t.id, active_word(t, at) if t.words else -1, st) for t, st in zip(visible, states))
        if key not in images:
            img = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
            for t, st in zip(visible, states):
                draw_item(img, t, active_word(t, at) if t.words else -1, st)
            path = workdir / f"txt_{len(images)}.png"
            img.save(path, compress_level=1)
            images[key] = path
        entries.append((images[key], length))

    for a, b in zip(times, times[1:]):
        if b - a < 1e-4:
            continue
        mid = (a + b) / 2
        animating = any(t.start <= mid < t.end and any(wa <= mid < wb for wa, wb in anim_windows(t)) for t in items)
        if not animating:
            frame(mid, b - a)
            continue
        # An entrance or exit is running: one picture per video frame.
        k, at = 0, a
        while at < b - 1e-6:
            length = min(step, b - at)
            frame(at + length / 2, length)
            k += 1
            at = a + k * step

    listing = workdir / "text.txt"
    lines = ["ffconcat version 1.0"]
    for path, dur in entries:
        lines += [f"file '{path}'", f"duration {dur:.4f}"]
    lines.append(f"file '{entries[-1][0]}'")  # the demuxer needs the last file twice to honor its duration
    listing.write_text("\n".join(lines) + "\n")
    return listing
