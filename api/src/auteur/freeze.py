"""Freeze frame: hold the picture at a moment of a clip for a while, then carry on.

The frame is taken from the source at full resolution and becomes a still picture media (like an
uploaded PNG); the clip is split there and the still goes in between, with the clip's look (grade,
crop, framing, position) copied so the hold doesn't jump.
"""

import subprocess
import tempfile
from pathlib import Path

import numpy as np

from auteur.media import MediaError, ingest
from auteur.timeline import Project
from auteur.timeline.models import CropKey
from auteur.timeline.ops import MIN_CLIP, AddClip, Op, SetCrop, SetCropRect, SetFit, SetGrade, SetTransform, Split, new_id


class FreezeError(ValueError):
    pass


def freeze(p: Project, project_dir: Path, clip_id: str, at: float, duration: float) -> list[Op]:
    """Ingest the frame at timeline time `at` of the clip and return the ops that hold it for `duration`."""
    tl = p.timeline
    i = next((k for k, c in enumerate(tl.clips) if c.id == clip_id), None)
    if i is None:
        raise FreezeError(f"Clip {clip_id!r} not found")
    clip, start = tl.clips[i], tl.clip_starts()[i]
    local = at - start
    if not 0 <= local <= clip.duration:
        raise FreezeError(f"{at:.2f}s is outside clip {clip_id!r} ({start:.2f}-{start + clip.duration:.2f}s)")
    if not 0.2 <= duration <= 30:
        raise FreezeError("A freeze lasts 0.2-30 seconds")
    m = p.media[clip.media_id]
    source_t = clip.src_out - local * clip.speed if clip.reverse else clip.to_source(local)
    source_t = min(max(source_t, 0), max(m.duration - 1 / max(m.fps, 1), 0))

    media_id = new_id("media")
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "frame.png"
        proc = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{source_t:.3f}", "-i", str(m.path), "-frames:v", "1", str(png)],
            capture_output=True, text=True,
        )
        if proc.returncode != 0 or not png.exists():
            raise FreezeError("Couldn't read that frame")
        try:
            still = ingest(project_dir, media_id, f"Freeze {m.name} @ {source_t:.1f}s", png)
        except MediaError as e:
            raise FreezeError(str(e)) from None
    p.media[still.id] = still

    freeze_id = new_id("clip")
    ops: list[Op] = []
    index = i + 1
    if MIN_CLIP <= local <= clip.duration - MIN_CLIP:
        ops.append(Split(clip_id=clip.id, at=round(at, 3)))
    elif local < MIN_CLIP:
        index = i  # at the very start: hold before the clip
    ops.append(AddClip(id=freeze_id, media_id=still.id, src_in=0, src_out=round(duration, 3), index=index))
    # The same look as the clip, so the picture doesn't jump when it stops moving.
    ops.append(SetGrade(clip_ids=[freeze_id], grade=clip.grade))
    if clip.transform:
        ops.append(SetTransform(clip_id=freeze_id, transform=clip.transform))
    if clip.crop_rect:
        ops.append(SetCropRect(clip_id=freeze_id, crop_rect=clip.crop_rect))
    if clip.fit != "fill":
        ops.append(SetFit(clip_id=freeze_id, fit=clip.fit, backdrop=clip.backdrop))
    if clip.crop:
        # Hold the crop where it was at that moment (keys are fractions of the frame, so they carry over).
        ts = [k.t for k in clip.crop]
        cx = float(np.interp(local, ts, [k.cx for k in clip.crop]))
        cy = float(np.interp(local, ts, [k.cy for k in clip.crop]))
        ops.append(SetCrop(clip_id=freeze_id, keys=[CropKey(t=0, cx=round(cx, 4), cy=round(cy, 4))]))
    return ops
