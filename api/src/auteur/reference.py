"""Grading toward a reference image ("make it look like this still").

A reference is reduced to a small feature vector: the tone curve (luma at five percentiles), saturation,
overall color cast, and the color of its shadows and its highlights (the split-tone). For each clip we
search the ordinary Grade fields for the setting whose graded frames come closest to those features,
applying grades with `grade.apply`, the exact math of the export. The result is a normal grade the
user can keep adjusting; it copies the palette and contrast, not the scene's lighting.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from auteur import grade as G
from auteur.timeline.models import Grade

# Searched fields: (name, low, high, first step). Hues wrap around.
PARAMS = [
    ("exposure", -1.5, 1.5, 0.3),
    ("contrast", -0.6, 0.9, 0.25),
    ("highlights", -0.8, 0.6, 0.25),
    ("shadows", -0.6, 0.6, 0.25),
    ("fade", 0.0, 0.6, 0.15),
    ("saturation", -0.9, 0.7, 0.25),
    ("temperature", -0.9, 0.9, 0.25),
    ("tint", -0.7, 0.7, 0.25),
    ("shadow_tone", 0.0, 1.0, 0.3),
    ("shadow_hue", 0.0, 360.0, 40.0),
    ("highlight_tone", 0.0, 1.0, 0.3),
    ("highlight_hue", 0.0, 360.0, 40.0),
]
HUES = {"shadow_hue", "highlight_hue"}

# Five tone points, saturation, then three chroma pairs (overall, shadows, highlights). Chroma is a small
# number, so it weighs more; the tone curve matters most for "the look".
WEIGHTS = np.array([1.2, 1.4, 1.4, 1.4, 1.2, 1.6, 3, 3, 4, 4, 4, 4], dtype=np.float32)


def load(path: Path, width: int = 240) -> np.ndarray:
    """A reference image as float RGB 0..1, small enough to measure quickly."""
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((width, width))
        return np.asarray(im, dtype=np.float32) / 255


def save(src: Path, dest: Path, longest: int = 1600) -> tuple[int, int]:
    """Normalize an uploaded image to a JPEG (for display and for the vision model). Raises on non-images."""
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((longest, longest))
        dest.parent.mkdir(parents=True, exist_ok=True)
        im.save(dest, "JPEG", quality=88)
        return im.size


def _chroma(rgb_mean: np.ndarray) -> tuple[float, float]:
    """Warmth (red vs blue) and green-magenta, relative to brightness."""
    r, g, b = (float(x) for x in rgb_mean)
    total = max(r + g + b, 1e-3)
    return (r - b) / total, (g - (r + b) / 2) / total


def features(rgb: np.ndarray) -> np.ndarray:
    px = rgb.reshape(-1, 3)
    luma = px @ np.array(G.LUMA, dtype=np.float32)
    p05, p25, p50, p75, p95 = np.percentile(luma, [5, 25, 50, 75, 95])
    mx, mn = px.max(-1), px.min(-1)
    sat = float(np.where(mx > 1e-3, (mx - mn) / np.maximum(mx, 1e-3), 0).mean())
    lows, highs = px[luma <= p25], px[luma >= p75]
    return np.array(
        [p05, p25, p50, p75, p95, sat, *_chroma(px.mean(0)), *_chroma(lows.mean(0)), *_chroma(highs.mean(0))],
        dtype=np.float32,
    )


def distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.sqrt((((a - b) * WEIGHTS) ** 2).sum()))


def _grade(base: Grade, values: dict[str, float]) -> Grade:
    return base.model_copy(update=values)


def _search(values: dict[str, float], names: list[str], steps: dict[str, float], cost, rounds: int) -> tuple[dict[str, float], float]:
    """Pattern search: each round tries a step both ways on every named field, keeps the better move,
    and halves a field's step when neither move helps."""
    bounds = {name: (lo, hi) for name, lo, hi, _ in PARAMS}
    best = cost(values)
    for _ in range(rounds):
        for name in names:
            lo, hi = bounds[name]
            moves = []
            for direction in (1, -1):
                trial = dict(values)
                x = values[name] + direction * steps[name]
                trial[name] = x % 360 if name in HUES else min(hi, max(lo, x))
                moves.append((cost(trial), trial))
            c, trial = min(moves, key=lambda m: m[0])
            if c < best - 1e-4:
                best, values = c, trial
            else:
                steps[name] *= 0.5
    return values, best


def fit(base: Grade, frames: np.ndarray, target: np.ndarray) -> Grade:
    """The grade, starting from `base`, whose result on `frames` comes closest to `target`.

    Split-toning only acts once its strength is above zero, so a plain search never finds it. Three
    stages: tone and color cast first, then a sweep of hues and strengths for the shadows and the
    highlights, then a fine search over everything together."""
    small = frames[..., ::2, ::2, :]  # a quarter of the pixels is plenty for statistics
    values = {name: float(getattr(base, name)) for name, *_ in PARAMS}

    def cost(v: dict[str, float]) -> float:
        return distance(features(G.apply(_grade(base, v), small)), target)

    plain = [n for n, *_ in PARAMS if n not in HUES and not n.endswith("_tone")]
    values, best = _search(values, plain, {n: s for n, _, _, s in PARAMS}, cost, rounds=10)
    for part in ("shadow", "highlight"):
        for hue in range(0, 360, 30):
            for tone in (0.3, 0.6, 0.9):
                trial = {**values, f"{part}_hue": float(hue), f"{part}_tone": tone}
                c = cost(trial)
                if c < best - 1e-4:
                    best, values = c, trial
    fine = {n: (12.0 if n in HUES else s * 0.4) for n, _, _, s in PARAMS}
    values, best = _search(values, [n for n, *_ in PARAMS], fine, cost, rounds=8)
    return _grade(base, {k: round(v, 3) for k, v in values.items()})


def blend(base: Grade, matched: Grade, strength: float) -> Grade:
    """Part of the way from base to matched; hues are taken whole (they only act through the tones)."""
    values = {}
    for name, *_ in PARAMS:
        a, b = float(getattr(base, name)), float(getattr(matched, name))
        values[name] = b if name in HUES else round(a + (b - a) * strength, 3)
    return base.model_copy(update=values)


def match_clips(
    bases: list[Grade], frames: list[np.ndarray], ref: np.ndarray, strength: float,
) -> list[tuple[Grade, float, float]]:
    """(grade, distance before, distance after) per clip. Each clip is fitted on its own, so clips that
    started different end up alike: matching the reference also matches them to each other."""
    target = features(ref)
    out = []
    for base, f in zip(bases, frames):
        before = distance(features(G.apply(base, f)), target)
        g = blend(base, fit(base, f, target), strength)
        out.append((g, before, distance(features(G.apply(g, f)), target)))
    return out


def describe(ref: np.ndarray) -> str:
    """Plain words for the reference's measured look, for the agent."""
    f = features(ref)
    contrast = f[4] - f[0]
    warm, _, sh_warm, _, hi_warm, _ = f[6:]
    parts = [
        f"midtones {f[2]:.2f}",
        f"{'high' if contrast > 0.75 else 'low' if contrast < 0.45 else 'medium'} contrast ({f[0]:.2f}-{f[4]:.2f})",
        f"saturation {f[5]:.2f}",
        f"{'warm' if warm > 0.03 else 'cool' if warm < -0.03 else 'neutral'} overall",
    ]
    if abs(sh_warm - hi_warm) > 0.05:
        parts.append(f"split-tone: {'cool' if sh_warm < hi_warm else 'warm'} shadows, {'warm' if hi_warm > sh_warm else 'cool'} highlights")
    if f[0] > 0.12:
        parts.append("lifted (faded) blacks")
    return ", ".join(parts)


def closeness(d: float) -> str:
    """A distance in words, for tool output and the checker."""
    return "very close" if d < 0.08 else "close" if d < 0.16 else "partly there" if d < 0.3 else "far"

