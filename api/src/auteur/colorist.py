"""Choosing grades: preset looks, automatic correction from frame statistics, and clip matching.

Everything here produces plain Grade values; what a grade does to pixels lives in grade.py.
"""

import math
from statistics import median

import numpy as np

from auteur import grade as G
from auteur.timeline.models import Grade

# Each look at full intensity. Numeric fields scale with intensity; hues are taken as-is.
LOOKS: dict[str, dict[str, float]] = {
    "hangat": {"temperature": 0.35, "tint": 0.05, "saturation": 0.08, "highlight_hue": 35, "highlight_tone": 0.35},
    "cinematic": {
        "contrast": 0.25, "saturation": -0.05, "fade": 0.1, "highlights": -0.15,
        "shadow_hue": 195, "shadow_tone": 0.55, "highlight_hue": 30, "highlight_tone": 0.45,
    },
    "film": {"contrast": 0.15, "saturation": -0.15, "fade": 0.35, "highlight_hue": 40, "highlight_tone": 0.25, "shadow_hue": 160, "shadow_tone": 0.15},
    "moody": {
        "exposure": -0.25, "contrast": 0.3, "saturation": -0.3, "temperature": -0.2, "shadows": -0.15,
        "shadow_hue": 220, "shadow_tone": 0.35, "vignette": 0.5,
    },
    "vintage": {"fade": 0.45, "saturation": -0.25, "temperature": 0.3, "shadow_hue": 30, "shadow_tone": 0.3, "highlight_hue": 50, "highlight_tone": 0.3, "vignette": 0.3},
    "hitam_putih": {"saturation": -1.0, "contrast": 0.3, "vignette": 0.25},
    "cerah": {"exposure": 0.2, "saturation": 0.3, "contrast": 0.15, "shadows": 0.2},
    "dingin": {"temperature": -0.35, "tint": -0.03, "saturation": -0.05, "shadow_hue": 210, "shadow_tone": 0.3},
}

HUES = ("shadow_hue", "highlight_hue")
NUMERIC = [name for name in Grade.model_fields if name not in (*HUES, "look", "log")]


def _bounds(name: str) -> tuple[float, float]:
    lo = hi = None
    for m in Grade.model_fields[name].metadata:
        lo = getattr(m, "ge", lo)
        hi = getattr(m, "le", hi)
    return lo, hi


def clamp_grade(values: dict[str, float]) -> dict[str, float]:
    out = {}
    for k, v in values.items():
        lo, hi = _bounds(k)
        out[k] = round(min(max(v, lo), hi), 3)
    return out


def combine(
    base: Grade, look: str | None, intensity: float, adjust: dict[str, float] | None = None, log: str | None = None,
) -> Grade:
    """base (correction) + look x intensity + explicit adjustments, after an optional log conversion."""
    values = base.model_dump(exclude={"look", "log"})
    log = log or base.log
    if log != "none":
        # Log footage is also desaturated by design; give the color back before the look.
        values["saturation"] += 0.2
    if look:
        for k, v in LOOKS[look].items():
            if k in HUES:
                values[k] = v
            else:
                values[k] += v * intensity
    for k, v in (adjust or {}).items():
        if k in HUES:
            values[k] = v
        elif k in values:
            values[k] += v
    return Grade(**clamp_grade(values), look=look, log=log)


def warmth(s: dict[str, float]) -> float:
    return (s["r"] - s["b"]) / max(s["r"] + s["b"], 1e-3)


def green_cast(s: dict[str, float]) -> float:
    mean = (s["r"] + s["g"] + s["b"]) / 3
    return (s["g"] - (s["r"] + s["b"]) / 2) / max(mean, 1e-3)


def auto_correct(s: dict[str, float]) -> Grade:
    """A gentle correction toward a neutral, well exposed image.

    Corrections are partial on purpose: a night street should stay a night street and warm stage
    lights should stay warm, so exposure aims at a lower target for low-key footage and white
    balance only removes about half of a cast.
    """
    luma = max(s["luma"], 0.02)
    target = 0.45 if luma >= 0.2 else min(0.3, luma * 1.5)
    exposure = max(-0.8, min(0.8, math.log2(target / luma) * 0.7))
    # Never push the brightest pixels (stage lights, sky) into pure white just to lift the average.
    if exposure > 0 and s["p995"] > 0.05:
        exposure = min(exposure, max(0.0, math.log2(0.97 / s["p995"])))
    temperature = max(-0.4, min(0.4, -warmth(s) / 0.12 * 0.4))
    tint = max(-0.4, min(0.4, green_cast(s) / 0.08 * 0.5))
    values = {"exposure": exposure, "temperature": temperature, "tint": tint}
    if s["clipped"] > 0.02:
        values["highlights"] = -0.3
    if s["crushed"] > 0.04:
        values["shadows"] = 0.25
    return Grade(**clamp_grade(values))


def match(grades: list[Grade], frames: list[np.ndarray]) -> list[Grade]:
    """Nudge each clip's grade so brightness and warmth match the median clip."""
    measured = [G.stats(G.apply(g, f)) for g, f in zip(grades, frames)]
    ref_luma = median(s["luma"] for s in measured)
    ref_warmth = median(warmth(s) for s in measured)
    out = []
    for g, s in zip(grades, measured):
        values = g.model_dump(exclude={"look", "log"})
        # Bounded nudges: matching should even out clips, not repaint any one of them.
        values["exposure"] += max(-0.5, min(0.5, math.log2(ref_luma / max(s["luma"], 0.02)) * 0.8))
        values["temperature"] += max(-0.3, min(0.3, (ref_warmth - warmth(s)) / 0.12 * 0.8))
        out.append(Grade(**clamp_grade(values), look=g.look, log=g.log))
    return out


LOOK_LABELS = {
    "hangat": "Hangat", "cinematic": "Cinematic", "film": "Film", "moody": "Moody",
    "vintage": "Vintage", "hitam_putih": "Hitam putih", "cerah": "Cerah", "dingin": "Dingin",
}

FrameCache = dict[tuple[str, float, float], np.ndarray]


def clip_frames(cache: FrameCache, m, clip) -> np.ndarray:
    key = (m.id, clip.src_in, clip.src_out)
    if key not in cache:
        cache[key] = G.sample_frames(m, clip.src_in, clip.src_out, n=6)
    return cache[key]


def grade_clips(
    media: dict, clips: list, look: str | None, intensity: float, auto: bool, match_clips: bool,
    adjust: dict[str, float] | None, cache: FrameCache, log: str = "none",
) -> list[tuple[str, Grade, dict, dict]]:
    """Grades for `clips`: (clip id, grade, stats before, stats after). Shared by the agent's
    `warna` tool and the editor's look buttons. With a log profile, correction is measured on the
    converted image, since the flat log signal itself is not what anyone will see."""
    frames = [clip_frames(cache, media[c.media_id], c) for c in clips]
    before = [G.stats(f) for f in frames]
    converted = Grade(log=log)
    measured = [G.stats(G.apply(converted, f)) for f in frames] if log != "none" else before
    bases = [
        (auto_correct(s) if auto else Grade()).model_copy(update={"log": log}) for s in measured
    ]
    if match_clips and len(clips) > 1:
        bases = match(bases, frames)
    grades = [combine(b, look, intensity, adjust, log) for b in bases]
    return [(c.id, g, s, G.stats(G.apply(g, f))) for c, g, s, f in zip(clips, grades, before, frames)]
