import pytest

from auteur.timeline import Grade, Media, OpError, Project, op_adapter
from auteur.timeline.models import CropKey
from auteur.timeline.ops import AddClip, AddText, Delete, Move, SetCrop, SetGrade, Split, Trim


@pytest.fixture
def project() -> Project:
    p = Project(id="p1", name="test")
    for mid, dur in [("m1", 20.0), ("m2", 10.0)]:
        p.media[mid] = Media(
            id=mid, name=f"{mid}.mp4", path=f"/tmp/{mid}.mp4", duration=dur,
            fps=30, width=1920, height=1080, has_audio=True,
        )
    return p


def add(p: Project, media_id: str, a: float, b: float) -> str:
    p.commit("agent", "add", [AddClip(media_id=media_id, src_in=a, src_out=b)])
    return p.timeline.clips[-1].id


def test_add_clips_and_duration(project: Project) -> None:
    add(project, "m1", 2, 7)
    add(project, "m2", 0, 3)
    assert project.timeline.duration == 8
    assert project.timeline.clip_starts() == [0, 5]


def test_add_clip_past_media_end_fails(project: Project) -> None:
    with pytest.raises(OpError, match="past the end"):
        project.commit("agent", "add", [AddClip(media_id="m2", src_in=5, src_out=12)])
    assert project.timeline.clips == []
    assert project.history == []


def test_split_uses_timeline_time_and_shifts_crop(project: Project) -> None:
    add(project, "m2", 0, 3)
    cid = add(project, "m1", 10, 16)  # timeline 3..9
    project.commit("agent", "crop", [SetCrop(clip_id=cid, keys=[CropKey(t=0, cx=0.2, cy=0.5), CropKey(t=4, cx=0.8, cy=0.5)])])
    project.commit("user", "split", [Split(clip_id=cid, at=5)])  # 2s into the clip

    left, right = project.timeline.clips[1:]
    assert (left.src_in, left.src_out) == (10, 12)
    assert (right.src_in, right.src_out) == (12, 16)
    assert [k.t for k in left.crop] == [0]
    assert [k.t for k in right.crop] == [2]


def test_split_at_edge_fails(project: Project) -> None:
    cid = add(project, "m1", 0, 5)
    with pytest.raises(OpError):
        project.commit("user", "split", [Split(clip_id=cid, at=5)])


def test_trim_move_delete(project: Project) -> None:
    a = add(project, "m1", 0, 10)
    b = add(project, "m2", 0, 5)
    project.commit("user", "trim", [Trim(clip_id=a, src_in=2)])
    project.commit("user", "move", [Move(clip_id=b, index=0)])
    assert [c.id for c in project.timeline.clips] == [b, a]
    assert project.timeline.duration == 13
    project.commit("user", "delete", [Delete(clip_id=b)])
    assert [c.id for c in project.timeline.clips] == [a]


def test_commit_is_atomic(project: Project) -> None:
    a = add(project, "m1", 0, 10)
    before = project.timeline
    with pytest.raises(OpError):
        project.commit("agent", "bad batch", [Trim(clip_id=a, src_out=5), Delete(clip_id="nope")])
    assert project.timeline == before


def test_undo_redo_and_undo_run(project: Project) -> None:
    add(project, "m1", 0, 10)
    project.commit("agent", "grade", [SetGrade(grade=Grade(temperature=0.3))], run_id="r1")
    project.commit("agent", "title", [AddText(text="Halo", start=0, end=2)], run_id="r1")
    assert len(project.timeline.texts) == 1

    assert project.undo_run("r1") == 2
    assert project.timeline.texts == []
    assert project.timeline.clips[0].grade.temperature == 0

    project.redo()
    assert project.timeline.clips[0].grade.temperature == 0.3
    project.undo()
    assert project.timeline.clips[0].grade.temperature == 0


def test_new_commit_clears_redo(project: Project) -> None:
    add(project, "m1", 0, 10)
    project.undo()
    add(project, "m2", 0, 5)
    assert project.redo() is None


def test_ops_parse_from_json() -> None:
    op = op_adapter.validate_python({"op": "trim", "clip_id": "c1", "src_out": 4})
    assert isinstance(op, Trim)
    with pytest.raises(ValueError):
        op_adapter.validate_python({"op": "set_grade", "grade": {"exposure": 9}})


def test_project_roundtrips_json(project: Project) -> None:
    add(project, "m1", 0, 10)
    project.commit("user", "title", [AddText(text="Halo", start=0, end=2)])
    again = Project.model_validate_json(project.model_dump_json())
    assert again == project
