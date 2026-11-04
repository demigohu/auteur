"""The OpenCV effects pass (tracked blur/highlight) keeps frames on their real times."""

import subprocess
from pathlib import Path

import cv2
import numpy as np
import pytest

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


@pytest.mark.parametrize("rate", ["30000/1001", "25", "24000/1001", "60"])
def test_constant_frame_rate_footage_stays_on_time(rate: str, tmp_path: Path) -> None:
    """Common camera rates: 4 s with brightness = 50 x time; frames keep their times to the end."""
    src = tmp_path / "cfr.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=c=black:s=64x64:r={rate}:d=4",
        "-vf", "geq=lum='16+T*50':cb=128:cr=128", "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv420p", str(src),
    ], check=True)
    m = Media(id="m", name="m", path=str(src), **{k: v for k, v in probe(src).items() if k != "recorded_at"})
    track = Track(id="t", media_id="m", prompt="x", fps=10, width=64, height=64, total_frames=40, objects={"0": {0: (0, 0, 2, 2)}})
    clip = Clip(id="c", media_id="m", src_in=0.5, src_out=4, effects=[Blur(track_id="t", hold=0.3)])
    out = apply_effects(clip, m, {"t": track}, tmp_path / "fx.mp4")
    cap = cv2.VideoCapture(str(out))
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames = []
    while (got := cap.read())[0]:
        frames.append(got[1])
    assert abs(len(frames) / fps - 3.5) < 0.1  # the whole range, no more, no less
    for local in (0.1, 1.7, 3.3):  # source times 0.6, 2.2, 3.8: start, middle, end
        lum = float(frames[round(local * fps)][20:40, 20:40].mean())
        expected = 50 * (0.5 + local) * 255 / 219
        assert abs(lum - expected) < 6, (rate, local, lum, expected)



def test_phone_footage_stays_on_time_through_preview_proxy_and_export(tmp_path: Path) -> None:
    """Variable frame rate plus a rotation flag, like phone video: every derived file shows the right moment."""
    from auteur.media import ingest, sam_proxy
    from auteur.render import render
    from auteur.timeline import Timeline

    raw, phone = tmp_path / "raw.mp4", tmp_path / "phone.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=96x64:r=40:d=6",
        "-f", "lavfi", "-i", "sine=f=440:d=6", "-vf", "geq=lum='16+T*30':cb=128:cr=128,select='if(lt(t,3),not(mod(n,4)),1)'",
        "-fps_mode", "vfr", "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(raw),
    ], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-display_rotation", "90", "-i", str(raw), "-c", "copy", str(phone)], check=True)
    proj = tmp_path / "proj"
    m = ingest(proj, "m1", "phone.mp4", phone)
    assert (m.width, m.height) == (64, 96)  # shown upright

    def shown(path: Path, t: float) -> float:
        info = probe(path)
        w, h = info["width"], info["height"]
        raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1",
                              "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout
        assert h > w  # portrait everywhere
        v = np.frombuffer(raw, np.uint8).reshape(h, w)[h // 3: 2 * h // 3, w // 3: 2 * w // 3].mean()
        return float(v * 219 / 255 / 30)  # luma back to the time it was filmed

    for path in (proj / "media" / "m1" / "preview.mp4", sam_proxy(proj, "m1")):
        for t in (1.0, 2.6, 4.0, 5.5):  # in the 10 fps part and the 40 fps part
            assert abs(shown(path, t) - t) < 0.1, (path.name, t)
    tl = Timeline(aspect="9:16", clips=[Clip(id="c", media_id="m1", src_in=1.5, src_out=5.5)])
    out = render(tl, {"m1": m}, tmp_path / "out.mp4", scale=1 / 6)
    for t in (0.5, 1.4, 2.5, 3.8):
        assert abs(shown(out, t) - (1.5 + t)) < 0.1, ("export", t)


def _blurred_clip_timeline(sample_video: Path):
    from auteur.timeline import Timeline

    m = Media(id="m", name="m", path=str(sample_video), **{k: v for k, v in probe(sample_video).items() if k != "recorded_at"})
    track = Track(id="t", media_id="m", prompt="face", fps=15, width=m.width, height=m.height, total_frames=60,
                  objects={"0": {k: (100, 100, 300, 300) for k in range(60)}})
    clip = Clip(id="c", media_id="m", src_in=0, src_out=4, effects=[Blur(track_id="t")])
    return Timeline(clips=[clip]), {"m": m}, {"t": track}


def test_export_progress_moves_during_the_blur_pass(sample_video: Path, tmp_path: Path) -> None:
    from auteur.render import render

    tl, media, tracks = _blurred_clip_timeline(sample_video)
    seen: list[float] = []
    render(tl, media, tmp_path / "out.mp4", scale=1 / 4, on_progress=seen.append, tracks=tracks)
    during_fx = [v for v in seen if v < 0.5]
    assert len(during_fx) > 10 and during_fx == sorted(during_fx)  # the first half moves frame by frame
    assert seen[-1] > 0.9


def test_cancel_stops_the_blur_pass(sample_video: Path, tmp_path: Path) -> None:
    import threading

    from auteur.render import RenderCancelled, render

    tl, media, tracks = _blurred_clip_timeline(sample_video)
    cancel = threading.Event()
    seen: list[float] = []

    def progress(v: float) -> None:
        seen.append(v)
        if v > 0.1:
            cancel.set()

    with pytest.raises(RenderCancelled):
        render(tl, media, tmp_path / "out.mp4", scale=1 / 4, on_progress=progress, tracks=tracks, cancel=cancel)
    assert max(seen) < 0.5  # stopped inside the blur pass, before ffmpeg
    assert not (tmp_path / "out.mp4").exists()


def test_ingest_moves_files_across_filesystems(tmp_path: Path, monkeypatch) -> None:
    """In Docker the data directory is its own volume: a picture made in /tmp can't be renamed into it."""
    import errno
    import os

    from PIL import Image

    from auteur.media import ingest

    png = tmp_path / "made-elsewhere" / "generated.png"
    png.parent.mkdir()
    Image.new("RGB", (64, 112), (240, 120, 40)).save(png)
    def no_cross_device(real):
        def move(src, dst, *args, **kwargs):
            if "made-elsewhere" in str(src):
                raise OSError(errno.EXDEV, "Invalid cross-device link")
            return real(src, dst, *args, **kwargs)
        return move

    monkeypatch.setattr(os, "rename", no_cross_device(os.rename))
    monkeypatch.setattr(os, "replace", no_cross_device(os.replace))
    m = ingest(tmp_path / "proj", "m1", "Generated", png)
    assert m.image == "still" and (tmp_path / "proj" / "media" / "m1" / "original.png").exists()
    assert not png.exists()  # moved, not left behind
