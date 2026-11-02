import json
import subprocess
from pathlib import Path

import pytest

from auteur.media import probe
from auteur.render import render
from auteur.timeline import Media, OpError, Project
from auteur.timeline.models import CropKey, Transition, Zoom
from auteur.timeline.ops import (
    AddAudio, AddClip, AddOverlay, AddText, SetCrop, SetFinish, SetSpeed, SetTransition, SetZoom, Split,
)


@pytest.fixture
def project() -> Project:
    p = Project(id="p", name="t")
    p.media["v"] = Media(id="v", name="v", path="v.mp4", duration=30, fps=60, width=1920, height=1080, has_audio=True)
    p.media["a"] = Media(id="a", name="song", path="a.mp3", duration=60, fps=0, width=0, height=0, has_audio=True, kind="audio")
    p.commit("user", "x", [
        AddClip(id="c1", media_id="v", src_in=0, src_out=4),
        AddClip(id="c2", media_id="v", src_in=10, src_out=14),
        AddClip(id="c3", media_id="v", src_in=20, src_out=24),
    ])
    return p


def test_speed_and_crossfade_timing(project: Project) -> None:
    project.commit("user", "x", [
        SetSpeed(clip_id="c2", speed=0.5),
        SetTransition(clip_id="c2", transition=Transition(kind="crossfade", duration=1)),
        SetTransition(clip_id="c3", transition=Transition(kind="hitam", duration=1)),
    ])
    tl = project.timeline
    assert [c.duration for c in tl.clips] == [4, 8, 4]
    assert tl.clip_starts() == [0, 3, 11]  # the crossfade overlaps by 1s; a dip doesn't
    assert tl.duration == 15


def test_split_slow_motion_clip_maps_to_source(project: Project) -> None:
    project.commit("user", "x", [SetSpeed(clip_id="c2", speed=0.5)])
    project.commit("user", "split", [Split(clip_id="c2", at=4 + 2, new_clip_id="c2b")])  # 2s into an 8s clip
    left, right = project.timeline.clips[1:3]
    assert (left.src_in, left.src_out, right.src_in) == (10, 11, 11)
    assert left.duration == 2 and right.duration == 6


def test_speed_change_keeps_crop_keys_on_the_same_source_moment(project: Project) -> None:
    project.commit("user", "x", [SetCrop(clip_id="c1", keys=[CropKey(t=2, cx=0.3, cy=0.5)])])
    project.commit("user", "x", [SetSpeed(clip_id="c1", speed=0.5)])
    assert project.timeline.clips[0].crop[0].t == 4


def test_invalid_transitions_and_media_kinds(project: Project) -> None:
    with pytest.raises(OpError, match="first clip"):
        project.commit("user", "x", [SetTransition(clip_id="c1", transition=Transition(kind="crossfade", duration=0.5))])
    project.commit("user", "x", [SetSpeed(clip_id="c2", speed=2)])  # now 2s long
    with pytest.raises(OpError, match="too long"):
        project.commit("user", "x", [SetTransition(clip_id="c2", transition=Transition(kind="crossfade", duration=1.5))])
    with pytest.raises(OpError, match="is audio"):
        project.commit("user", "x", [AddClip(media_id="a", src_in=0, src_out=3)])


def test_music_defaults_to_video_length(project: Project) -> None:
    project.commit("user", "x", [AddAudio(media_id="a", src_in=5)])
    a = project.timeline.audio[0]
    assert (a.src_in, a.src_out) == (5, 17)


def test_full_render_with_every_feature(tmp_path: Path, sample_video: Path) -> None:
    song = tmp_path / "song.mp3"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=12", str(song)], check=True)
    p = Project(id="p", name="t")
    p.media["v"] = Media(id="v", name="v", path=str(sample_video), **{k: v for k, v in probe(sample_video).items()})
    p.media["a"] = Media(id="a", name="song", path=str(song), **probe(song))
    p.commit("user", "x", [
        AddClip(id="c1", media_id="v", src_in=0, src_out=3),
        AddClip(id="c2", media_id="v", src_in=1, src_out=3),
        AddClip(id="c3", media_id="v", src_in=0, src_out=2),
        SetSpeed(clip_id="c2", speed=0.5),
        SetTransition(clip_id="c2", transition=Transition(kind="crossfade", duration=0.5)),
        SetTransition(clip_id="c3", transition=Transition(kind="putih", duration=0.6)),
        SetZoom(clip_id="c3", zoom=Zoom(start=1, end=1.3)),
        AddOverlay(media_id="v", src_in=0, src_out=1.5, start=1, layout="kanan_bawah"),
        AddAudio(media_id="a"),
        SetFinish(letterbox=2.39, grain=0.3),
        AddText(text="Hari ini", start=0.2, end=2, style="title"),
    ])
    out = render(p.timeline, p.media, tmp_path / "out.mp4", scale=0.25)
    info = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(out)],
        capture_output=True, text=True, check=True,
    ).stdout)
    assert abs(float(info["format"]["duration"]) - p.timeline.duration) < 0.1
    assert {s["codec_type"] for s in info["streams"]} == {"video", "audio"}


def test_fps_and_duplicate(project: Project) -> None:
    from auteur.timeline.ops import DuplicateClip, SetFps

    project.commit("user", "x", [SetFps(fps=24), DuplicateClip(clip_id="c2", new_clip_id="c2copy")])
    tl = project.timeline
    assert tl.fps == 24
    assert [c.id for c in tl.clips] == ["c1", "c2", "c2copy", "c3"]
    assert (tl.clips[2].src_in, tl.clips[2].src_out) == (10, 14)
