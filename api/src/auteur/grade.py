"""Color grading: one definition of what a Grade does to pixels, shared by export, preview and checks.

A grade becomes (1) a per-channel tone curve (a 1D LUT), (2) a saturation matrix and (3) a vignette.
The renderer feeds the LUT to ffmpeg's lut1d, the matrix to colorchannelmixer and multiplies a
vignette mask; the editor applies the same curve and matrix as an SVG filter (web/src/lib/grade.ts
ports `curve()` line by line), so the preview matches the export. The checker applies the same
LUT to sampled source frames with numpy, so it can measure clipping without rendering.
"""

import colorsys
import math
import subprocess
from pathlib import Path

import numpy as np

from auteur.timeline.models import Grade, Media

LUT_SIZE = 256
LUMA = (0.2126, 0.7152, 0.0722)  # Rec. 709, same weights as the SVG saturate matrix uses


def _hue_rgb(hue: float) -> tuple[float, float, float]:
    return colorsys.hsv_to_rgb((hue % 360) / 360, 1.0, 1.0)


def log_to_linear(profile: str, x: float) -> float:
    """Camera log signal (0..1) to scene-linear light (18% gray = 0.18), from each maker's spec."""
    if profile == "apple_log":
        r0, rt, c, beta, gamma, delta = -0.05641088, 0.01, 47.28711236, 0.00964052, 0.08550479, 0.69336945
        pt = c * (rt - r0) ** 2
        return 2 ** ((x - delta) / gamma) - beta if x >= pt else math.sqrt(max(x, 0) / c) + r0
    if profile == "slog3":
        if x >= 171.2102946929 / 1023:
            return 10 ** ((x * 1023 - 420) / 261.5) * 0.19 - 0.01
        return (x * 1023 - 95) * 0.01125 / (171.2102946929 - 95)
    if profile == "vlog":
        return (x - 0.125) / 5.6 if x < 0.181 else 10 ** ((x - 0.598206) / 0.241514) - 0.00873
    # "generic": an unknown flat profile, decoded like S-Log3, the most common shape.
    return log_to_linear("slog3", x)


def linear_to_display(r: float) -> float:
    """Filmic shoulder: 18% gray lands near 0.46 and highlights roll off instead of clipping."""
    return 1 - math.exp(-3.4 * max(r, 0.0))


def curve(g: Grade, v: float, channel: int) -> float:
    """Tone curve for one channel (0=R, 1=G, 2=B) at input v in 0..1."""
    if g.log != "none":
        v = linear_to_display(log_to_linear(g.log, v))
    # Exposure in stops, then white balance as channel gains.
    v *= 2 ** g.exposure
    gains = (1 + 0.12 * g.temperature, 1 - 0.08 * g.tint, 1 - 0.12 * g.temperature)
    v *= gains[channel]
    v = min(max(v, 0.0), 1.0)
    # Shadows lift/crush the low end, highlights the top, each fading out toward the other end.
    v += 0.25 * g.shadows * (1 - v) ** 3 * min(1.0, v * 8 + 0.2)
    v += 0.25 * g.highlights * v**3
    v = min(max(v, 0.0), 1.0)
    # Contrast: blend toward (or away from) a smoothstep S-curve; endpoints stay fixed.
    s = v * v * (3 - 2 * v)
    v += g.contrast * (s - v)
    # Split toning: push shadows and highlights toward their hues.
    sh, hi = _hue_rgb(g.shadow_hue)[channel], _hue_rgb(g.highlight_hue)[channel]
    v += 0.18 * g.shadow_tone * (sh - 0.5) * (1 - v) ** 2
    v += 0.18 * g.highlight_tone * (hi - 0.5) * v**2
    # Fade: lift the black point like a matte film print.
    v = 0.16 * g.fade + v * (1 - 0.16 * g.fade)
    return min(max(v, 0.0), 1.0)


def lut(g: Grade, size: int = LUT_SIZE) -> np.ndarray:
    """(size, 3) array: output of each channel's curve at size evenly spaced inputs."""
    xs = [i / (size - 1) for i in range(size)]
    return np.array([[curve(g, x, c) for c in range(3)] for x in xs], dtype=np.float32)


def saturation_matrix(g: Grade) -> np.ndarray:
    """3x3 RGB matrix scaling saturation around Rec. 709 luma (the SVG feColorMatrix 'saturate' form)."""
    s = 1 + g.saturation
    r, gg, b = LUMA
    return np.array([
        [r + (1 - r) * s, gg - gg * s, b - b * s],
        [r - r * s, gg + (1 - gg) * s, b - b * s],
        [r - r * s, gg - gg * s, b + (1 - b) * s],
    ], dtype=np.float32)


def vignette_factor(g: Grade, nx: np.ndarray, ny: np.ndarray) -> np.ndarray:
    """Brightness multiplier at normalized positions (0..1); 1 = untouched."""
    r = np.sqrt((nx - 0.5) ** 2 + (ny - 0.5) ** 2) / math.sqrt(0.5)
    t = np.clip((r - 0.45) / 0.55, 0, 1)
    return 1 - 0.65 * g.vignette * t * t * (3 - 2 * t)


def is_identity(g: Grade) -> bool:
    if g.log != "none":
        return False
    return all(v == 0 for k, v in g.model_dump().items() if k not in ("shadow_hue", "highlight_hue", "look", "log"))


def apply(g: Grade, rgb: np.ndarray) -> np.ndarray:
    """Grade float RGB pixels (..., 3) in 0..1, exactly as the renderer does (without vignette)."""
    table = lut(g)
    idx = np.clip(np.rint(rgb * (LUT_SIZE - 1)), 0, LUT_SIZE - 1).astype(np.int32)
    out = np.stack([table[idx[..., c], c] for c in range(3)], axis=-1)
    return np.clip(out @ saturation_matrix(g).T, 0, 1)


# --- ffmpeg ---------------------------------------------------------------------------------------

def write_cube(g: Grade, path: Path) -> Path:
    table = lut(g)
    lines = [f"LUT_1D_SIZE {LUT_SIZE}", "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"]
    lines += [f"{r:.6f} {gg:.6f} {b:.6f}" for r, gg, b in table]
    path.write_text("\n".join(lines) + "\n")
    return path


def ffmpeg_filters(g: Grade, cube: Path) -> list[str]:
    """Tone curve + saturation. The vignette is applied after the crop (see render.py)."""
    if is_identity(g):
        return []
    m = saturation_matrix(g)
    mixer = ":".join(f"{name}={m[i][j]:.6f}" for i, row in enumerate("rgb") for j, name in enumerate(
        (f"{row}r", f"{row}g", f"{row}b")
    ))
    return ["format=gbrp", f"lut1d=file='{cube}':interp=linear", f"colorchannelmixer={mixer}"]


def write_vignette_mask(g: Grade, w: int, h: int, path: Path) -> Path:
    from PIL import Image

    ys, xs = np.mgrid[0:h, 0:w]
    f = vignette_factor(g, (xs + 0.5) / w, (ys + 0.5) / h)
    Image.fromarray((f * 255).round().astype(np.uint8), "L").convert("RGB").save(path)
    return path


# --- measuring footage -----------------------------------------------------------------------------

def sample_frames(m: Media, start: float, end: float, n: int = 8, width: int = 160) -> np.ndarray:
    """n frames evenly spread over [start, end) as float RGB (n, h, w, 3) in 0..1."""
    span = max(end - start, 0.1)
    h = round(width * m.height / m.width / 2) * 2
    frames = []
    for i in range(n):
        t = start + span * (i + 0.5) / n
        raw = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", str(Path(m.path).resolve()),
             "-frames:v", "1", "-vf", f"scale={width}:{h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            capture_output=True, check=True,
        ).stdout
        if len(raw) == width * h * 3:
            frames.append(np.frombuffer(raw, np.uint8).reshape(h, width, 3))
    if not frames:
        raise RuntimeError(f"Could not sample frames from {m.name}")
    return np.stack(frames).astype(np.float32) / 255


def stats(rgb: np.ndarray) -> dict[str, float]:
    luma = rgb @ np.array(LUMA, dtype=np.float32)
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = np.where(mx > 1e-3, (mx - mn) / np.maximum(mx, 1e-3), 0)
    mean = rgb.reshape(-1, 3).mean(0)
    return {
        "luma": float(luma.mean()),
        "p02": float(np.percentile(luma, 2)),
        "p98": float(np.percentile(luma, 98)),
        "p995": float(np.percentile(luma, 99.5)),
        "p50": float(np.percentile(luma, 50)),
        "clipped": float((luma > 0.985).mean()),
        "crushed": float((luma < 0.015).mean()),
        "saturation": float(sat.mean()),
        "r": float(mean[0]), "g": float(mean[1]), "b": float(mean[2]),
    }


def looks_like_log(s: dict[str, float]) -> bool:
    """Flat, washed-out footage: lifted blacks, no real whites, little color (typical of log profiles)."""
    return s["p02"] > 0.07 and s["p98"] < 0.8 and s["saturation"] < 0.22


def describe(s: dict[str, float]) -> str:
    return (
        f"brightness {s['luma']:.2f}, range {s['p02']:.2f}-{s['p98']:.2f}, saturation {s['saturation']:.2f}, "
        f"clipped {s['clipped']:.1%}, crushed {s['crushed']:.1%}, "
        f"warmth {(s['r'] - s['b']) / max(s['r'] + s['b'], 1e-3):+.2f}"
    )
