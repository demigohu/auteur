import pytest

from auteur.agent.tools import filler_ops, tool_specs
from auteur.timeline import Media, Project
from auteur.timeline.ops import AddClip


@pytest.fixture
def project() -> Project:
    p = Project(id="p", name="t")
    p.media["m1"] = Media(id="m1", name="a", path="a.mp4", duration=30, fps=30, width=1920, height=1080, has_audio=True)
    p.commit("agent", "add", [AddClip(id="c0", media_id="m1", src_in=0, src_out=2), AddClip(id="c1", media_id="m1", src_in=5, src_out=15)])
    return p


def test_filler_ops_cut_middle_start_and_end(project: Project) -> None:
    cuts = [(4.0, 5.5), (8.0, 9.0), (11.0, 11.5), (14.8, 16.0)]  # start edge, two middles, end edge
    ops, tl, removed = filler_ops(project.timeline, "c1", cuts, project.media)

    # Replaying the ops through a commit must give the same timeline as the scratch run.
    project.commit("agent", "filler", ops)
    assert project.timeline == tl
    ranges = [(c.src_in, c.src_out) for c in tl.clips if c.media_id == "m1"][1:]
    assert ranges == [(5.5, 8.0), (9.0, 11.0), (11.5, 14.8)]
    assert removed == pytest.approx(0.5 + 1.0 + 0.5 + 0.2)
    assert tl.clips[1].id == "c1"


def test_filler_ops_whole_clip(project: Project) -> None:
    ops, tl, _ = filler_ops(project.timeline, "c0", [(0, 2)], project.media)
    assert [c.id for c in tl.clips] == ["c1"]


def test_tool_specs_have_no_refs() -> None:
    import json

    specs = json.dumps(tool_specs())
    assert "$ref" not in specs and "$defs" not in specs


def test_event_bus_replays_only_the_active_run() -> None:
    from auteur.events import EventBus

    bus = EventBus()
    bus.publish("p", {"type": "run_started"})
    bus.publish("p", {"type": "tool_call"})
    assert bus.subscribe("p").qsize() == 2  # joined mid-run: replays it
    bus.publish("p", {"type": "run_finished"})
    assert bus.subscribe("p").qsize() == 0
