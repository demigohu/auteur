"""Subject-following crops and the framing check the checker runs on them.

Geometry matches render.crop_filter: the crop window is the largest window of the output aspect that
fits the source, centered on the crop key and clamped inside the frame. Everything here works in
normalized source coordinates (0..1).
"""

from auteur.timeline.models import Clip, CropKey, Media
from auteur.tracking import Track

SAMPLE_FPS = 15
KEY_TOLERANCE = 0.01  # max error (fraction of the frame) when dropping redundant crop keys


def window_size(m: Media, out_w: int, out_h: int) -> tuple[float, float]:
    ar = out_w / out_h
    if m.width / m.height > ar:
        return (m.height * ar) / m.width, 1.0
    return 1.0, (m.width / ar) / m.height


def window_at(keys: list[CropKey], t: float, cw: float, ch: float) -> tuple[float, float, float, float]:
    """Crop window (x, y, w, h) at clip-local time t."""
    cx, cy = 0.5, 0.5
    if keys:
        if t <= keys[0].t:
            cx, cy = keys[0].cx, keys[0].cy
        elif t >= keys[-1].t:
            cx, cy = keys[-1].cx, keys[-1].cy
        else:
            for a, b in zip(keys, keys[1:]):
                if t < b.t:
                    k = (t - a.t) / max(b.t - a.t, 1e-6)
                    cx, cy = a.cx + (b.cx - a.cx) * k, a.cy + (b.cy - a.cy) * k
                    break
    x = min(max(cx - cw / 2, 0), 1 - cw)
    y = min(max(cy - ch / 2, 0), 1 - ch)
    return x, y, cw, ch


def _subject_centers(track: Track, object_id: str, clip: Clip) -> list[tuple[float, float] | None]:
    n = max(1, round(clip.duration * SAMPLE_FPS))
    out: list[tuple[float, float] | None] = []
    for i in range(n):
        box = track.box_at(object_id, clip.src_in + i / SAMPLE_FPS)
        if box is None:
            out.append(None)
            continue
        x1, y1, x2, y2 = (box[0] / track.width, box[1] / track.height, box[2] / track.width, box[3] / track.height)
        # Aim a bit above the box center: for people that keeps the face in the upper part of the frame.
        out.append(((x1 + x2) / 2, y1 + 0.4 * (y2 - y1)))
    return out


def _fill_gaps(points: list[tuple[float, float] | None]) -> list[tuple[float, float]]:
    known = [p for p in points if p is not None]
    if not known:
        return [(0.5, 0.5)] * len(points)
    filled, last = [], known[0]
    for p in points:
        last = p or last
        filled.append(last)
    return filled


def _smooth(values: list[float], window: int) -> list[float]:
    if window <= 1:
        return values
    half = window // 2
    out = []
    for i in range(len(values)):
        seg = values[max(0, i - half) : i + half + 1]
        out.append(sum(seg) / len(seg))
    return out


def _simplify(keys: list[CropKey]) -> list[CropKey]:
    """Drop keys that linear interpolation between their neighbours already reproduces."""
    if len(keys) <= 2:
        return keys
    kept = [keys[0]]
    for i in range(1, len(keys) - 1):
        a, b = kept[-1], keys[i + 1]
        k = (keys[i].t - a.t) / max(b.t - a.t, 1e-6)
        ex, ey = a.cx + (b.cx - a.cx) * k, a.cy + (b.cy - a.cy) * k
        if abs(ex - keys[i].cx) > KEY_TOLERANCE or abs(ey - keys[i].cy) > KEY_TOLERANCE:
            kept.append(keys[i])
    kept.append(keys[-1])
    return kept


def follow_keys(track: Track, object_id: str, clip: Clip, smooth_seconds: float) -> list[CropKey]:
    """Crop keys that follow the object, smoothed over `smooth_seconds` (bigger = calmer camera)."""
    centers = _fill_gaps(_subject_centers(track, object_id, clip))
    window = max(1, round(smooth_seconds * SAMPLE_FPS))
    xs = _smooth([c[0] for c in centers], window)
    ys = _smooth([c[1] for c in centers], window)
    keys = [
        CropKey(t=round(min(i / SAMPLE_FPS, clip.duration), 3), cx=round(min(max(x, 0), 1), 4), cy=round(min(max(y, 0), 1), 4))
        for i, (x, y) in enumerate(zip(xs, ys))
    ]
    return _simplify(keys)


def out_of_frame(
    track: Track, object_id: str, clip: Clip, m: Media, out_w: int, out_h: int, margin: float = 0.1,
) -> list[tuple[float, float]]:
    """Clip-local time ranges where the subject's center leaves the crop window (inner 80% horizontally)."""
    cw, ch = window_size(m, out_w, out_h)
    bad: list[float] = []
    n = max(1, round(clip.duration * SAMPLE_FPS))
    for i in range(n):
        t = i / SAMPLE_FPS
        box = track.box_at(object_id, clip.src_in + t)
        if box is None:
            continue
        cx = (box[0] + box[2]) / 2 / track.width
        cy = (box[1] + box[3]) / 2 / track.height
        x, y, w, h = window_at(clip.crop, t, cw, ch)
        if not (x + margin * w <= cx <= x + (1 - margin) * w) or not (y <= cy <= y + h):
            bad.append(t)
    ranges: list[tuple[float, float]] = []
    for t in bad:
        if ranges and t - ranges[-1][1] <= 2 / SAMPLE_FPS:
            ranges[-1] = (ranges[-1][0], t)
        else:
            ranges.append((t, t))
    # Ignore flickers shorter than a third of a second.
    return [(round(a, 2), round(b + 1 / SAMPLE_FPS, 2)) for a, b in ranges if b - a >= 0.3]
