"""Turn the source art in web/assets-src/ into the files the site serves from web/public/assets/.

Run with the API venv (numpy + Pillow): api/.venv/bin/python web/scripts/prepare_assets.py

- Stickers and logos lose their flat white/cream background (flood fill from the border).
- Photos and illustrations become WebP at the size they are shown, so the landing stays light.
- The paper texture is made seamless (crossfaded with a half-offset copy of itself).
- The app icon and the social card are cut to their required sizes.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets-src"
OUT = ROOT / "public" / "assets"
APP = ROOT / "src" / "app"


def cut_background(img: Image.Image, thresh: int = 28) -> Image.Image:
    """Clear the flat background connected to the image border, keeping inner whites (die-cut borders
    sit behind an outline, so the fill stops there)."""
    rgb = img.convert("RGB")
    w, h = rgb.size
    sentinel = (1, 254, 3)
    filled = rgb.copy()
    for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]:
        if filled.getpixel((x, y)) != sentinel:
            ImageDraw.floodfill(filled, (x, y), sentinel, thresh=thresh)
    a = np.asarray(filled)
    bg = np.all(a == sentinel, axis=-1)
    alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    return out.crop(out.getbbox())


def fit(img: Image.Image, longest: int) -> Image.Image:
    img = img.copy()
    img.thumbnail((longest, longest), Image.LANCZOS)
    return img


def cover(img: Image.Image, w: int, h: int) -> Image.Image:
    """Scale to cover w×h and crop the middle."""
    s = max(w / img.width, h / img.height)
    img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    left, top = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((left, top, left + w, top + h))


def seamless(img: Image.Image) -> Image.Image:
    t = np.asarray(img.convert("L"), float)
    h, w = t.shape
    shifted = np.roll(t, (h // 2, w // 2), axis=(0, 1))
    y, x = np.mgrid[0:h, 0:w]
    # 1 in the middle, 0 at the edges: the edges come from the shifted copy, whose edges are interior pixels.
    wy = 1 - np.abs((y - h / 2) / (h / 2))
    wx = 1 - np.abs((x - w / 2) / (w / 2))
    m = np.clip(np.minimum(wx, wy) * 3, 0, 1)
    out = t * m + shifted * (1 - m)
    out = (out - out.mean()) + 128  # mid grey = flat under overlay blending
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "L")


def webp(img: Image.Image, name: str, quality: int = 82) -> None:
    img.save(OUT / name, "WEBP", quality=quality, method=6)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    src = lambda n: Image.open(SRC / n)  # noqa: E731

    seamless(fit(src("paper-texture.png"), 768)).save(OUT / "paper-texture.png", optimize=True)

    logo = cut_background(src("Logo.png"), thresh=40)
    fit(logo, 900).save(OUT / "logo.png", optimize=True)
    mark = cut_background(src("logo-mark.png"), thresh=40)
    square = Image.new("RGBA", (max(mark.size),) * 2, (0, 0, 0, 0))
    square.paste(mark, ((square.width - mark.width) // 2, (square.height - mark.height) // 2), mark)
    square.resize((512, 512), Image.LANCZOS).save(APP / "icon.png", optimize=True)
    square.resize((180, 180), Image.LANCZOS).save(APP / "apple-icon.png", optimize=True)

    for n in ["mascot", "mascot-wink", "mascot-wow"]:
        webp(fit(src(f"{n}.png").convert("RGBA"), 640), f"{n}.webp", 88)
    for n in ["sticker-clapper", "sticker-rec", "sticker-reel"]:
        webp(fit(cut_background(src(f"{n}.png")), 480), f"{n}.webp", 88)

    for n in ["hero-1", "hero-2", "hero-3"]:
        webp(cover(src(f"{n}.png").convert("RGB"), 600, 480), f"{n}.webp")
    webp(fit(src("polaroid.png").convert("RGB"), 480), "polaroid.webp")
    for i in range(1, 7):
        webp(fit(src(f"work-{i}.png").convert("RGB"), 1000), f"work-{i}.webp")

    cover(src("og.png").convert("RGB"), 1200, 630).save(APP / "opengraph-image.png", optimize=True)

    for p in sorted(OUT.glob("*")) + sorted(APP.glob("*.png")):
        if p.is_file():
            print(f"{p.relative_to(ROOT)}  {p.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
