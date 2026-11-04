"""Per-frame object effects (blur, highlight) rendered with OpenCV before the ffmpeg pass.

ffmpeg can't follow a moving box from a track, so each clip with effects is first rewritten frame
by frame into a temporary video-only file; the renderer then uses it in place of the source's video
(audio still comes from the source). Boxes are interpolated between SAM detections and grown a
little, so a mask that flickers for a frame does not leak the face it should hide.
"""

import subprocess
from collections.abc import Callable
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


def apply_effects(
    clip: Clip, m: Media, tracks: dict[str, Track], out: Path, on_frame: Callable[[float], bool] | None = None,
) -> Path | None:
    """Write clip's source range, with its effects, to `out` (video only, constant frame rate).

    Frames come from ffmpeg at a constant rate, so frame n is at src_in + n / fps exactly. Phone footage is
    often variable-rate: counting frames from OpenCV's average fps drifted seconds away from the track's
    times (blurs on the wrong spot) and from the sound.

    `on_frame` gets the fraction done after each frame; returning False stops the pass (None is returned).
    """
    fps = max(1, round(m.fps or 30))
    w, h = m.width, m.height  # after rotation; ffmpeg applies the phone's rotation like the proxy SAM saw
    proc = subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-ss", f"{clip.src_in:.3f}", "-i", str(Path(m.path).resolve()),
         "-t", f"{clip.src_out - clip.src_in:.3f}", "-vf", f"fps={fps},scale={w}:{h}", "-an",
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
        stdout=subprocess.PIPE,
    )
    assert proc.stdout is not None
    writer = cv2.VideoWriter(str(out), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    size, n = w * h * 3, 0
    total = max(1, round((clip.src_out - clip.src_in) * fps))
    try:
        while len(raw := proc.stdout.read(size)) == size:
            frame = np.frombuffer(raw, np.uint8).reshape(h, w, 3).copy()
            t = clip.src_in + n / fps
            for effect in clip.effects:
                track = tracks.get(effect.track_id)
                if track is None:
                    continue
                if isinstance(effect, Blur):
                    _blur(frame, _boxes(track, effect.targets(list(track.objects)), t, w, h, effect.hold), effect.strength)
                elif isinstance(effect, Highlight):
                    _highlight(frame, _boxes(track, effect.object_ids or list(track.objects), t, w, h), effect.dim_background)
            writer.write(frame)
            n += 1
            if on_frame and not on_frame(min(n / total, 1.0)):
                proc.kill()
                return None
    finally:
        writer.release()
        proc.stdout.close()
        proc.wait()
    if n == 0:
        raise RuntimeError(f"Could not read {m.name} at {clip.src_in}s")
    return out
