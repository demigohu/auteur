"""A clip's pose over time: keyframes (position, scale, rotation, opacity) and in/out animations.

Everything reduces to one list of keys with straight lines between them (`effective_keys`): the user's
keys (or the static transform), and each animation sampled at ANIM_SAMPLES points of its eased curve.
The export turns the keys into ffmpeg expressions; the preview (web/src/lib/animate.ts) builds the same
list and interpolates it the same way, so both show the same pose at every frame.
"""

from dataclasses import dataclass, replace

from auteur.timeline.models import Clip, ClipAnim, Transform

ANIM_SAMPLES = 8


@dataclass(frozen=True)
class Pose:
    x: float = 0.0
    y: float = 0.0
    scale: float = 1.0
    rotation: float = 0.0
    opacity: float = 1.0


def _lerp(a: Pose, b: Pose, k: float) -> Pose:
    return Pose(*(va + (vb - va) * k for va, vb in zip(
        (a.x, a.y, a.scale, a.rotation, a.opacity), (b.x, b.y, b.scale, b.rotation, b.opacity)
    )))


def base_keys(c: Clip) -> list[tuple[float, Pose]]:
    if c.transform_keys:
        return [(k.t, Pose(k.x, k.y, k.scale, k.rotation, k.opacity)) for k in sorted(c.transform_keys, key=lambda k: k.t)]
    t = c.transform or Transform()
    return [(0.0, Pose(t.x, t.y, t.scale, t.rotation, t.opacity))]


def pose_in(keys: list[tuple[float, Pose]], t: float) -> Pose:
    """Linear between keys, held before the first and after the last."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, p0), (t1, p1) in zip(keys, keys[1:]):
        if t < t1:
            return _lerp(p0, p1, (t - t0) / max(t1 - t0, 1e-6))
    return keys[-1][1]


def _offset(kind: str, p: Pose, entering: bool) -> Pose:
    """Where an animation starts (entering) or ends (leaving), relative to the pose it meets."""
    s = 1 if entering else -1
    match kind:
        case "fade":
            return replace(p, opacity=0)
        case "zoom_in":
            return replace(p, scale=p.scale * (0.6 if entering else 1.4), opacity=0)
        case "zoom_out":
            return replace(p, scale=p.scale * (1.4 if entering else 0.6), opacity=0)
        case "slide_left":
            return replace(p, x=p.x + s)
        case "slide_right":
            return replace(p, x=p.x - s)
        case "slide_up":
            return replace(p, y=p.y + s)
        case "slide_down":
            return replace(p, y=p.y - s)
        case "spin":
            return replace(p, rotation=p.rotation - 180 * s, scale=p.scale * 0.3, opacity=0)
    return p


def _anim_keys(anim: ClipAnim, base: list[tuple[float, Pose]], start: float, entering: bool) -> list[tuple[float, Pose]]:
    out = []
    for i in range(ANIM_SAMPLES + 1):
        u = i / ANIM_SAMPLES
        t = start + u * anim.duration
        meet = pose_in(base, t)
        # Ease out when entering (fast, then settles), ease in when leaving.
        k = 1 - (1 - u) ** 3 if entering else u**3
        far = _offset(anim.kind, meet, entering)
        out.append((round(t, 4), _lerp(far, meet, k) if entering else _lerp(meet, far, k)))
    return out


def effective_keys(c: Clip) -> list[tuple[float, Pose]]:
    """The clip's pose as keys over its local time [0, duration]."""
    base = base_keys(c)
    d = c.duration
    if not c.anim_in and not c.anim_out:
        return base
    a_in = min(c.anim_in.duration, d / 2) if c.anim_in else 0.0
    a_out = min(c.anim_out.duration, d / 2) if c.anim_out else 0.0
    keys = [(t, p) for t, p in base if a_in < t < d - a_out]
    if c.anim_in:
        keys += _anim_keys(c.anim_in.model_copy(update={"duration": a_in}), base, 0.0, True)
    elif base[0][0] > 0:
        keys.append((0.0, pose_in(base, 0)))
    if c.anim_out:
        keys += _anim_keys(c.anim_out.model_copy(update={"duration": a_out}), base, d - a_out, False)
    keys.sort(key=lambda k: k[0])
    return keys


def is_static(keys: list[tuple[float, Pose]]) -> bool:
    return len({p for _, p in keys}) <= 1
