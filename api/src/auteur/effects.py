"""Per-frame object effects (blur, highlight) rendered with OpenCV before the ffmpeg pass.

ffmpeg can't follow a moving box from a track, so each clip with effects is first rewritten frame
by frame into a temporary video-only file; the renderer then uses it in place of the source's video
(audio still comes from the source). Boxes are interpolated between SAM detections and grown a
little, so a mask that flickers for a frame does not leak the face it should hide.
"""

from pathlib import Path

import cv2
import numpy as np

from auteur.timeline.models import Blur, Clip, Highlight, Media
from auteur.tracking import Track

GROW = 0.15  # enlarge boxes by this fraction on each side


def _boxes(track: Track, object_ids: list[str], t: float, w: int, h: int, hold: float = 0.5) -> list[tuple[int, int, int, int]]:
    out = []
    for oid in object_ids:
        box = track.box_at(oid, t, hold)
        if box is None:
            continue
        x1, y1, x2, y2 = box[0] / track.width * w, box[1] / track.height * h, box[2] / track.width * w, box[3] / track.height * h
        gx, gy = (x2 - x1) * GROW, (y2 - y1) * GROW
        out.append((max(0, int(x1 - gx)), max(0, int(y1 - gy)), min(w, int(x2 + gx)), min(h, int(y2 + gy))))
    return out


def _blur(frame: np.ndarray, boxes: list[tuple[int, int, int, int]], strength: float) -> None:
    for x1, y1, x2, y2 in boxes:
        if x2 - x1 < 2 or y2 - y1 < 2:
            continue
        roi = frame[y1:y2, x1:x2]
        k = max(3, int(max(x2 - x1, y2 - y1) * (0.15 + 0.35 * strength)) | 1)
        blurred = cv2.GaussianBlur(roi, (k, k), 0)
        # Elliptical mask: reads as a natural face blur instead of a hard rectangle.
        mask = np.zeros(roi.shape[:2], np.uint8)
        cv2.ellipse(mask, ((x2 - x1) // 2, (y2 - y1) // 2), ((x2 - x1) // 2, (y2 - y1) // 2), 0, 0, 360, 255, -1)
        roi[mask > 0] = blurred[mask > 0]


def _highlight(frame: np.ndarray, boxes: list[tuple[int, int, int, int]], dim: float) -> None:
    mask = np.zeros(frame.shape[:2], np.float32)
    for x1, y1, x2, y2 in boxes:
        cv2.rectangle(mask, (x1, y1), (x2, y2), 1.0, -1)
    if boxes:
        k = max(3, int(min(frame.shape[:2]) * 0.06) | 1)
        mask = cv2.GaussianBlur(mask, (k, k), 0)
    factor = (1 - dim) + dim * mask[..., None]
    frame[:] = np.clip(frame.astype(np.float32) * factor, 0, 255).astype(np.uint8)


def apply_effects(clip: Clip, m: Media, tracks: dict[str, Track], out: Path) -> Path:
    """Write clip's source range, with its effects, to `out` (video only, source fps)."""
    cap = cv2.VideoCapture(str(Path(m.path).resolve()))
    fps = cap.get(cv2.CAP_PROP_FPS) or m.fps
    cap.set(cv2.CAP_PROP_POS_MSEC, clip.src_in * 1000)
    ok, frame = cap.read()
    if not ok:
        raise RuntimeError(f"Could not read {m.name} at {clip.src_in}s")
    h, w = frame.shape[:2]
    writer = cv2.VideoWriter(str(out), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    n = 0
    t = clip.src_in
    while ok and t < clip.src_out:
        for effect in clip.effects:
            track = tracks.get(effect.track_id)
            if track is None:
                continue
            if isinstance(effect, Blur):
                _blur(frame, _boxes(track, effect.targets(list(track.objects)), t, w, h, effect.hold), effect.strength)
            elif isinstance(effect, Highlight):
                _highlight(frame, _boxes(track, effect.object_ids or list(track.objects), t, w, h), effect.dim_background)
        writer.write(frame)
        ok, frame = cap.read()
        n += 1
        t = clip.src_in + n / fps
    writer.release()
    cap.release()
    return out
