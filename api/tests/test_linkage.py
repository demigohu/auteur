"""Linkage: text and B-roll follow the main-track moment they start on; music stays put."""

import pytest

from auteur.timeline import Media, Project
from auteur.timeline.ops import (
    AddAudio, AddClip, AddOverlay, AddText, Delete, Move, SetLinkage, SetSpeed, Split, Trim,
)


@pytest.fixture
def p() -> Project:
    """Clips a (0-4s) and b (4-10s); a title on b at 6s, a subtitle on b at 8s, B-roll at 5s, music at 0."""
    p = Project(id="p", name="t")
    for mid, d in (("ma", 10), ("mb", 10), ("song", 60)):
        p.media[mid] = Media(id=mid, name=mid, path=f"{mid}.mp4", duration=d, fps=30, width=1920, height=1080,
                             has_audio=True, kind="audio" if mid == "song" else "video")
    p.commit("user", "setup", [
        AddClip(id="a", media_id="ma", src_in=0, src_out=4),
        AddClip(id="b", media_id="mb", src_in=2, src_out=8),
        AddText(id="title", text="Title", start=6, end=7, style="title"),
        AddText(id="sub", text="Hello", start=8, end=9),
        AddOverlay(id="broll", media_id="ma", src_in=0, src_out=1, start=5),
        AddAudio(id="music", media_id="song", start=0),
    ])
    return p


def at(p: Project) -> dict[str, float]:
    tl = p.timeline
    return {**{t.id: t.start for t in tl.texts}, **{o.id: o.start for o in tl.overlays}, **{a.id: a.start for a in tl.audio}}


def test_deleting_an_earlier_clip_pulls_linked_items_back(p: Project) -> None:
    p.commit("user", "del", [Delete(clip_id="a")])
    assert at(p) == {"title": 2, "sub": 4, "broll": 1, "music": 0}


def test_trimming_a_clip_head_keeps_items_on_their_moment(p: Project) -> None:
    p.commit("user", "trim", [Trim(clip_id="b", src_in=3)])  # 1s off the head of b
    assert at(p)["title"] == 5 and at(p)["sub"] == 7


def test_reordering_carries_items_with_their_clip(p: Project) -> None:
    p.commit("user", "move", [Move(clip_id="b", index=0)])  # b now 0-6, a 6-10
    assert at(p) == {"title": 2, "sub": 4, "broll": 1, "music": 0}


def test_inserting_a_clip_pushes_later_items(p: Project) -> None:
    p.commit("user", "ins", [AddClip(id="c", media_id="ma", src_in=5, src_out=7, index=1)])
    assert at(p)["title"] == 8 and at(p)["broll"] == 7


def test_cutting_out_speech_removes_its_subtitle_but_keeps_the_title(p: Project) -> None:
    p.commit("user", "split", [Split(clip_id="b", at=7.5, new_clip_id="b2")])
    p.commit("user", "cut", [Delete(clip_id="b2")])  # the subtitle at 8s was in b2
    assert [t.id for t in p.timeline.texts] == ["title"]


def test_speed_change_scales_positions_inside_the_clip(p: Project) -> None:
    p.commit("user", "speed", [SetSpeed(clip_id="b", speed=2)])  # b: 4-7s now; 2s in becomes 1s in
    assert at(p)["title"] == 5


def test_linkage_off_leaves_everything_alone(p: Project) -> None:
    p.commit("user", "off", [SetLinkage(linkage=False)])
    p.commit("user", "del", [Delete(clip_id="a")])
    assert at(p) == {"title": 6, "sub": 8, "broll": 5, "music": 0}


def test_word_timings_move_with_their_subtitle(p: Project) -> None:
    from auteur.timeline.models import TextWord

    p.commit("user", "words", [AddText(id="w", text="Hi there", start=7, end=8,
                                       words=[TextWord(text="Hi", start=7, end=7.4), TextWord(text="there", start=7.4, end=8)])])
    p.commit("user", "del", [Delete(clip_id="a")])
    w = next(t for t in p.timeline.texts if t.id == "w")
    assert (w.start, [x.start for x in w.words]) == (3, [3, 3.4])
