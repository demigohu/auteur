"""The OpenCV effects pass (tracked blur/highlight) keeps frames on their real times."""

import subprocess
from pathlib import Path

import cv2
import numpy as np

from auteur.effects import apply_effects
from auteur.media import probe
from auteur.timeline.models import Blur, Clip, Media
from auteur.tracking import Track


def test_variable_frame_rate_footage_stays_on_time(tmp_path: Path) -> None:
    """Phone footage is often variable-rate. Here: 10 fps for a second, then 40 fps; brightness = 100 x time."""
    src = tmp_path / "vfr.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=40:d=2",
        "-vf", "geq=lum='T*100':cb=128:cr=128,select='if(lt(t,1),not(mod(n,4)),1)'", "-fps_mode", "vfr",
        "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv420p", str(src),
    ], check=True)
    m = Media(id="m", name="m", path=str(src), **{k: v for k, v in probe(src).items() if k != "recorded_at"})
    # A blur on a tiny corner box at the start: the frames go through the effects loop, the middle untouched.
    track = Track(id="t", media_id="m", prompt="x", fps=10, width=64, height=64, total_frames=20, objects={"0": {0: (0, 0, 2, 2)}})
    clip = Clip(id="c", media_id="m", src_in=0, src_out=2, effects=[Blur(track_id="t", hold=0.3)])
    out = apply_effects(clip, m, {"t": track}, tmp_path / "fx.mp4")

    cap = cv2.VideoCapture(str(out))
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames = []
    while (got := cap.read())[0]:
        frames.append(got[1])
    assert len(frames) == round(2 * fps)  # constant rate over the whole range
    # Times where a source frame and an output frame (25 fps) coincide; video luma 16-235 maps to RGB 0-255.
    for t in (0.6, 1.2, 1.6):
        lum = float(frames[round(t * fps)][20:40, 20:40].mean())
        expected = (100 * t - 16) * 255 / 219
        assert abs(lum - expected) < 6, (t, lum, expected)  # the picture shown at t is the one filmed at t
