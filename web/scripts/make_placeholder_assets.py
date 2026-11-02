"""Placeholder art for web/public/assets until the real assets land (docs/DESIGN.md, "Assets").

Run with the API venv (numpy + Pillow): api/.venv/bin/python web/scripts/make_placeholder_assets.py
Each output keeps its final file name, so a real asset replaces it without code changes.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "public" / "assets"
rng = np.random.default_rng(7)


def paper_texture(size: int = 512) -> None:
    """Tileable embossed paper: band-passed noise (periodic by construction) lit from the top left.
    Mid grey means flat, so it can sit on any section color with mix-blend-mode: overlay."""
    f = np.fft.fftfreq(size)
    r = np.hypot(*np.meshgrid(f, f))
    spectrum = np.exp(-((r - 0.016) ** 2) / (2 * 0.006**2)) + 0.12 * np.exp(-((r - 0.05) ** 2) / (2 * 0.015**2))
    height = np.real(np.fft.ifft2(np.fft.fft2(rng.normal(size=(size, size))) * spectrum))
    height = np.tanh(height / height.std() * 1.6)  # rounded plateaus read as embossed blobs
    gy, gx = np.gradient(height)
    light = -(gx + gy) / np.abs(gx + gy).max()
    img = np.clip(128 + light * 115 + rng.normal(0, 3, (size, size)), 0, 255).astype(np.uint8)
    Image.fromarray(img, "L").save(OUT / "paper-texture.png", optimize=True)


def mascot(size: int = 900) -> None:
    """Soft 3D blob with a face: a wobbly sphere shaded from a fake normal map."""
    y, x = (np.mgrid[0:size, 0:size] - size / 2) / (size * 0.38)
    a = np.arctan2(y, x)
    wobble = 1 + 0.06 * np.sin(3 * a + 0.4) + 0.04 * np.sin(5 * a + 1.3) + 0.03 * np.sin(7 * a)
    d = np.hypot(x, y) / wobble
    inside = d < 1
    z = np.sqrt(np.clip(1 - d**2, 0, 1))
    n = np.stack([x / wobble, y / wobble, z], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9
    diffuse = np.clip(n @ np.array([-0.45, -0.6, 0.66]), 0, 1)
    spec = np.clip(n @ np.array([-0.3, -0.45, 0.84]), 0, 1) ** 40
    top, bottom = np.array([255, 143, 207]), np.array([255, 79, 31])
    t = np.clip((y + 1) / 2, 0, 1)[..., None]
    base = top * (1 - t) + bottom * t
    rgb = base * (0.35 + 0.75 * diffuse[..., None]) + 255 * spec[..., None] * 0.9
    alpha = np.clip((1 - d) * size * 0.2, 0, 1) * 255
    img = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha]).astype(np.uint8), "RGBA")
    face = ImageDraw.Draw(img)
    s = size / 900
    for ex in (360, 520):
        face.ellipse([ex * s, 380 * s, (ex + 34) * s, 440 * s], fill=(18, 17, 16))
        face.ellipse([(ex + 8) * s, 388 * s, (ex + 18) * s, 402 * s], fill=(255, 255, 255))
    face.arc([380 * s, 430 * s, 560 * s, 540 * s], 20, 160, fill=(18, 17, 16), width=int(14 * s))
    img.save(OUT / "mascot.png", optimize=True)


def card(name: str, w: int, h: int, colors: tuple[str, str], seed: int) -> None:
    """Stand-in for a frame grab: a soft two-tone gradient with grain and a few bokeh lights."""
    r = np.random.default_rng(seed)
    a, b = (np.array([int(c[i : i + 2], 16) for i in (1, 3, 5)]) for c in colors)
    t = np.linspace(0, 1, h)[:, None, None]
    img = a * (1 - t) + b * t + r.normal(0, 6, (h, w, 3))
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    glow = Image.new("RGB", (w, h))
    g = ImageDraw.Draw(glow)
    for _ in range(14):
        cx, cy, rad = r.uniform(0, w), r.uniform(0, h * 0.7), r.uniform(8, 40)
        g.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=tuple(int(v) for v in r.uniform(150, 255, 3)))
    im = Image.blend(im, Image.composite(glow, im, glow.convert("L")).filter(ImageFilter.GaussianBlur(10)), 0.55)
    im.save(OUT / name, quality=85)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    paper_texture()
    mascot()
    card("polaroid.jpg", 600, 600, ("#1d2a5c", "#ff8a3d"), 1)
    card("phone-reel.jpg", 540, 960, ("#0e1430", "#2e3bff"), 2)
    for i, colors in enumerate([("#101828", "#ff4f1f"), ("#0e3a22", "#c8f53c"), ("#2b0f3a", "#ff8fcf"), ("#141414", "#ffc22e"), ("#0b1a3d", "#2e3bff"), ("#1d1c1a", "#f2eee3")], 1):
        card(f"work-{i}.jpg", 960, 540, colors, 10 + i)
    print("\n".join(sorted(p.name for p in OUT.iterdir())))
