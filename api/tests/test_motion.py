"""Videos made in code: storyboard merging, putting scenes on the timeline, the build tool, the renderer."""

import asyncio
import shutil
import subprocess
from pathlib import Path

import pytest

from auteur import motion
from auteur.agent.tools import BuildScenesArgs, SceneNote, ToolContext, build_scenes
from auteur.timeline import Media, Project
from auteur.timeline.history import Storyboard, StoryScene
from auteur.timeline.models import Transition
from auteur.timeline.ops import AddClip, SetTransition


def scene(sid: str, **kw) -> StoryScene:
    return StoryScene(id=sid, title=kw.pop("title", sid), duration=kw.pop("duration", 3), brief=kw.pop("brief", f"brief {sid}"), **kw)


def video(mid: str, scene_id: str | None = None, duration: float = 3) -> Media:
    return Media(id=mid, name=mid, path=f"{mid}.mp4", duration=duration, fps=30, width=1920, height=1080,
                 has_audio=scene_id is None, scene_id=scene_id)


# --- merge_storyboard --------------------------------------------------------------------------------

def test_merge_keeps_unchanged_scenes_and_redrafts_changed_ones() -> None:
    current = Storyboard(brief="launch", style="dark, lime", scenes=[
        scene("s1", code="A", media_id="m1", status="ready"),
        scene("s2", code="B", media_id="m2", status="ready"),
    ])
    data = {"style": "dark, lime", "scenes": [
        {"id": "s2", "title": "s2", "duration": 3, "brief": "a new brief", "images": []},
        {"id": "s1", "title": "s1", "duration": 3, "brief": "brief s1", "images": []},
        {"id": "", "title": "Outro", "duration": 4, "brief": "logo", "images": ["ref_1", "ref_unknown"]},
    ]}
    board = motion.merge_storyboard(current, "launch", data, {"ref_1"})
    s2, s1, new = board.scenes
    assert (s1.status, s1.code, s1.media_id) == ("ready", "A", "m1")  # untouched, only moved
    assert (s2.status, s2.code, s2.brief) == ("draft", "B", "a new brief")  # kept code, to be updated
    assert new.id.startswith("scene_") and new.status == "draft" and new.images == ["ref_1"]
    assert board.duration == 10


def test_merge_redrafts_everything_on_a_new_style() -> None:
    current = Storyboard(brief="b", style="old", scenes=[scene("s1", status="ready", media_id="m1")])
    data = {"style": "new", "scenes": [{"id": "s1", "title": "s1", "duration": 3, "brief": "brief s1", "images": []}]}
    assert motion.merge_storyboard(current, "b", data, set()).scenes[0].status == "draft"


def test_merge_gives_duplicate_ids_new_ids() -> None:
    current = Storyboard(brief="b", style="s", scenes=[scene("s1")])
    item = {"id": "s1", "title": "s1", "duration": 3, "brief": "brief s1", "images": []}
    board = motion.merge_storyboard(current, "b", {"style": "s", "scenes": [item, item]}, set())
    assert board.scenes[0].id == "s1" and board.scenes[1].id != "s1"


# --- place_scenes ------------------------------------------------------------------------------------

def project_with(board: Storyboard, media: list[Media]) -> Project:
    p = Project(id="p", name="t", storyboard=board)
    for m in media:
        p.media[m.id] = m
    return p


def place(p: Project) -> list[str]:
    """Commit place_scenes and return the media ids on the video track; the ops must replay cleanly."""
    ops = motion.place_scenes(p.timeline, p.media, p.storyboard)
    if ops:
        p.commit("agent", "place", ops)
    return [c.media_id for c in p.timeline.clips]


def test_place_puts_ready_scenes_in_storyboard_order() -> None:
    board = Storyboard(brief="b", style="s", scenes=[
        scene("s1", media_id="m1", status="ready"), scene("s2", status="failed"), scene("s3", media_id="m3", status="ready"),
    ])
    p = project_with(board, [video("m1", "s1"), video("m3", "s3", duration=5)])
    assert place(p) == ["m1", "m3"]
    assert p.timeline.clips[1].src_out == 5
    assert motion.place_scenes(p.timeline, p.media, board) == []  # already in place


def test_place_swaps_a_rebuilt_scene_in_place_and_keeps_its_transition() -> None:
    board = Storyboard(brief="b", style="s", scenes=[scene("s1", media_id="m1"), scene("s2", media_id="m2")])
    p = project_with(board, [video("m1", "s1"), video("m2", "s2"), video("m2b", "s2", duration=4)])
    place(p)
    p.commit("user", "fade", [SetTransition(clip_id=p.timeline.clips[1].id, transition=Transition(kind="crossfade", duration=0.5))])
    board.scenes[1] = board.scenes[1].model_copy(update={"media_id": "m2b"})
    assert place(p) == ["m1", "m2b"]
    assert p.timeline.clips[1].transition and p.timeline.clips[1].transition.kind == "crossfade"


def test_place_follows_a_reorder_and_drops_removed_scenes() -> None:
    board = Storyboard(brief="b", style="s", scenes=[scene("s1", media_id="m1"), scene("s2", media_id="m2"), scene("s3", media_id="m3")])
    p = project_with(board, [video("m1", "s1"), video("m2", "s2"), video("m3", "s3")])
    place(p)
    board.scenes = [board.scenes[2], board.scenes[0]]  # s3 first, s2 removed
    assert place(p) == ["m3", "m1"]


def test_place_leaves_footage_alone_and_slots_new_scenes_after_their_neighbor() -> None:
    board = Storyboard(brief="b", style="s", scenes=[scene("s1", media_id="m1"), scene("s2", media_id="m2")])
    p = project_with(board, [video("m1", "s1"), video("m2", "s2"), video("foot")])
    p.commit("user", "add", [AddClip(media_id="foot", src_in=0, src_out=2), AddClip(media_id="m1", src_in=0, src_out=3),
                             AddClip(media_id="foot", src_in=2, src_out=3)])
    assert place(p) == ["foot", "m1", "m2", "foot"]


# --- build_scenes (Muse Wonder and the renderer faked) ------------------------------------------------

@pytest.fixture
def tiny_video(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("scene") / "scene.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=30:d=2",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)], check=True)
    return out


def test_build_scenes_ingests_renders_and_places_them(tmp_path: Path, tiny_video: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    board = Storyboard(brief="b", style="s", scenes=[scene("s1"), scene("s2"), scene("s3", media_id=None, status="ready")])
    p = Project(id="p", name="t", storyboard=board)
    seen: dict[str, str | None] = {}

    async def fake_build(board, sc, size, fps, images, workdir, add_cost, note=None, log=lambda _: None):
        seen[sc.id] = note
        if sc.id == "s2":
            raise motion.SceneError("Syntax error: line 3")
        add_cost(0.05)
        out = workdir / f"{sc.id}.mp4"
        shutil.copy(tiny_video, out)
        return motion.SceneBuild(code=f"// {sc.id}", video=out, notes=["checked its own frames: OK"])

    monkeypatch.setattr(motion, "build_scene", fake_build)
    events: list[dict] = []
    # A blank project has no folder on disk yet.
    ctx = ToolContext(project=p, project_dir=tmp_path / "proj_new", run_id="run_1", emit=events.append, save=lambda: None)
    out = asyncio.run(build_scenes(ctx, BuildScenesArgs(notes=[SceneNote(scene_id="s1", note="bigger title")])))

    s1, s2, s3 = board.scenes
    assert seen == {"s1": "bigger title", "s2": None, "s3": None}  # s3 is "ready" but has no render
    assert (s1.status, s1.code) == ("ready", "// s1")
    assert (s2.status, s2.error) == ("failed", "Syntax error: line 3")
    assert p.media[s1.media_id].scene_id == "s1" and not p.media[s1.media_id].has_audio
    assert [p.media[c.media_id].scene_id for c in p.timeline.clips] == ["s1", "s3"]
    assert "s2 FAILED" in out and ctx.cost == pytest.approx(0.10)
    assert events[-1]["type"] == "timeline"


def test_build_scenes_needs_a_storyboard(tmp_path: Path) -> None:
    from auteur.agent.tools import ToolError

    ctx = ToolContext(project=Project(id="p", name="t"), project_dir=tmp_path, run_id="r", emit=lambda e: None, save=lambda: None)
    with pytest.raises(ToolError, match="storyboard"):
        asyncio.run(build_scenes(ctx, BuildScenesArgs()))


# --- the real renderer ---------------------------------------------------------------------------------

needs_renderer = pytest.mark.skipif(
    shutil.which("node") is None or not (motion.MOTION_DIR / "node_modules").exists(),
    reason="motion/ renderer not installed (npm ci in motion/)",
)


@needs_renderer
def test_renderer_renders_a_scene(tmp_path: Path) -> None:
    code = """import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { fonts } from "@auteur/kit";
export const Scene = () => {
  const o = interpolate(useCurrentFrame(), [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "#111", color: "white", fontFamily: fonts.anton, fontSize: 80, opacity: o }}>Hi</AbsoluteFill>;
};"""
    out = tmp_path / "s.mp4"
    progress: list[float] = []
    job = {"code": code, "width": 640, "height": 360, "fps": 30, "durationInFrames": 30, "out": str(out)}
    asyncio.run(motion.run_renderer(job, progress.append))
    info = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height,nb_frames", "-of", "csv=p=0", str(out)],
                          capture_output=True, text=True, check=True).stdout.strip()
    assert info == "640,360,30"


@needs_renderer
def test_renderer_refuses_unsafe_code(tmp_path: Path) -> None:
    job = {"code": 'export const Scene = () => { fetch("/x"); return null; };', "width": 64, "height": 64, "fps": 30,
           "durationInFrames": 1, "out": str(tmp_path / "x.mp4")}
    with pytest.raises(motion.SceneError, match="fetch"):
        asyncio.run(motion.run_renderer(job))
    assert not (tmp_path / "x.mp4").exists()


def test_build_scenes_refuses_a_build_the_budget_cannot_cover(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from auteur.agent.tools import ToolError

    async def never(*args, **kwargs):
        raise AssertionError("no scene may be built over budget")

    monkeypatch.setattr(motion, "build_scene", never)
    board = Storyboard(brief="b", style="s", scenes=[scene(f"s{i}") for i in range(6)])
    p = Project(id="p", name="t", storyboard=board)
    ctx = ToolContext(project=p, project_dir=tmp_path, run_id="r", emit=lambda e: None, save=lambda: None, budget=1.0)
    with pytest.raises(ToolError, match=r"at most 4 scenes"):
        asyncio.run(build_scenes(ctx, BuildScenesArgs()))
    assert {s.status for s in board.scenes} == {"draft"}  # nothing was marked as building


async def test_a_wonder_request_that_never_answers_becomes_a_scene_error(monkeypatch) -> None:
    """The agent sees a timeout as a tool error it can retry, instead of waiting out the SDK's 10 minutes."""
    import httpx
    from openai import APITimeoutError

    from auteur import motion

    class Never:
        class responses:  # noqa: N801
            @staticmethod
            async def create(**kwargs):
                raise APITimeoutError(request=httpx.Request("POST", "https://api.meta.ai/v1/responses"))

    seen = {}
    monkeypatch.setattr(motion, "_client", lambda timeout: seen.setdefault("timeout", timeout) and Never)
    with pytest.raises(motion.SceneError, match="didn't answer the storyboard within 4 minutes"):
        await motion._ask_wonder(motion.STORYBOARD_TIMEOUT, "storyboard", input="x")
    assert seen["timeout"] == 240
