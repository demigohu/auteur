import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from auteur.main import app, project_lock


class FakeClerk:
    """Stands in for Clerk: the bearer token is the account id. Real verification is in test_auth.py."""

    def user_id(self, token: str | None) -> str | None:
        return token if token and token.startswith("user_") else None


@pytest.fixture(autouse=True)
def fake_clerk(monkeypatch: pytest.MonkeyPatch) -> None:
    import auteur.main as m

    monkeypatch.setattr(m, "clerk", FakeClerk())


def signed_in() -> TestClient:
    return TestClient(app, headers={"Authorization": f"Bearer user_{uuid.uuid4().hex[:12]}"})


@pytest.fixture
def client() -> TestClient:
    return signed_in()


@pytest.fixture
def project(client: TestClient, sample_video: Path) -> dict:
    p = client.post("/projects", json={"name": "Jalan-jalan"}).json()
    with sample_video.open("rb") as f:
        r = client.post(f"/projects/{p['id']}/media", files={"file": ("pantai.mp4", f, "video/mp4")})
    assert r.status_code == 200, r.text
    return r.json()


def test_upload_probes_and_builds_preview(client: TestClient, project: dict) -> None:
    [m] = project["media"]
    assert m["name"] == "pantai.mp4"
    assert m["duration"] == pytest.approx(4, abs=0.1)
    assert (m["width"], m["height"], m["has_audio"]) == (1280, 720, True)
    assert client.get(m["preview_url"]).status_code == 200
    assert client.get(m["thumb_url"]).headers["content-type"] == "image/jpeg"


def test_upload_rejects_non_video(client: TestClient) -> None:
    p = client.post("/projects", json={"name": "x"}).json()
    r = client.post(f"/projects/{p['id']}/media", files={"file": ("notes.txt", b"hello", "text/plain")})
    assert r.status_code == 400


def test_ops_undo_redo(client: TestClient, project: dict) -> None:
    pid, mid = project["id"], project["media"][0]["id"]
    r = client.post(f"/projects/{pid}/ops", json={
        "label": "Tambah klip",
        "ops": [{"op": "add_clip", "media_id": mid, "src_in": 0.5, "src_out": 3}],
    })
    assert r.status_code == 200, r.text
    view = r.json()
    assert len(view["timeline"]["clips"]) == 1
    assert view["history"][0]["author"] == "user"
    assert "before" not in view["history"][0]
    assert view["can_undo"] and not view["can_redo"]
    assert view["busy"] is False  # the handler's own lock must not look like an agent run

    view = client.post(f"/projects/{pid}/undo").json()
    assert view["timeline"]["clips"] == [] and view["can_redo"]
    view = client.post(f"/projects/{pid}/redo").json()
    assert len(view["timeline"]["clips"]) == 1

    # Reload from SQLite to make sure it persisted.
    assert client.get(f"/projects/{pid}").json()["timeline"] == view["timeline"]


def test_invalid_op_returns_agent_readable_error(client: TestClient, project: dict) -> None:
    r = client.post(f"/projects/{project['id']}/ops", json={
        "label": "x",
        "ops": [{"op": "add_clip", "media_id": project["media"][0]["id"], "src_in": 0, "src_out": 99}],
    })
    assert r.status_code == 400
    assert "past the end" in r.json()["detail"]


async def test_edits_blocked_while_agent_runs(client: TestClient, project: dict) -> None:
    import auteur.main as m

    class Running:
        def done(self) -> bool:
            return False

    lock = project_lock(project["id"])
    await lock.acquire()
    m._runs[project["id"]] = ("run_test", Running())
    try:
        r = client.post(f"/projects/{project['id']}/undo")
        assert r.status_code == 409
        assert client.get(f"/projects/{project['id']}").json()["busy"] is True
    finally:
        del m._runs[project["id"]]
        lock.release()


def test_run_quota_per_visitor() -> None:
    import auteur.main as main

    # Settings is a frozen dataclass read at import; flip the guard on just for this test.
    object.__setattr__(main.settings, "runs_per_visitor_per_day", 1)
    try:
        req = type("R", (), {"client": type("C", (), {"host": "1.2.3.4"})(), "state": type("S", (), {"account": "user_test"})()})()
        main.check_run_quota(req)
        with pytest.raises(main.HTTPException) as e:
            main.check_run_quota(req)
        assert e.value.status_code == 429
    finally:
        object.__setattr__(main.settings, "runs_per_visitor_per_day", 0)


def test_projects_need_an_account() -> None:
    r = TestClient(app).get("/projects")
    assert r.status_code == 401


def test_projects_are_private_to_their_owner(client: TestClient) -> None:
    p = client.post("/projects", json={"name": "Mine", "aspect": "9:16", "fps": 24}).json()
    assert (p["timeline"]["aspect"], p["timeline"]["fps"]) == ("9:16", 24)
    other = signed_in()
    assert other.get(f"/projects/{p['id']}").status_code == 404
    assert all(s["id"] != p["id"] for s in other.get("/projects").json())
    [summary] = [s for s in client.get("/projects").json() if s["id"] == p["id"]]
    assert summary["aspect"] == "9:16" and summary["thumb_url"] is None


def test_rename_and_delete(client: TestClient) -> None:
    pid = client.post("/projects", json={"name": "Draft"}).json()["id"]
    assert client.patch(f"/projects/{pid}", json={"name": "Final cut"}).json()["name"] == "Final cut"
    assert client.delete(f"/projects/{pid}").status_code == 200
    assert client.get(f"/projects/{pid}").status_code == 404


def test_spend_cap_per_account(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    import dataclasses

    import auteur.main as m

    pid = client.post("/projects", json={"name": "Spendy"}).json()["id"]
    p = m.store.get(pid)
    p.spent = 0.6
    m.store.save(p)
    monkeypatch.setattr(m, "settings", dataclasses.replace(m.settings, user_spend_cap_usd=0.5))
    r = client.post(f"/projects/{pid}/runs", json={"instruction": "make it short"})
    assert r.status_code == 429 and "$0.50" in r.json()["detail"]


def png(color: tuple[int, int, int]) -> bytes:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (64, 36), color).save(buf, "PNG")
    return buf.getvalue()


def test_reference_upload_grade_and_delete(client: TestClient, project: dict) -> None:
    pid, mid = project["id"], project["media"][0]["id"]
    client.post(f"/projects/{pid}/ops", json={"label": "Add", "ops": [{"op": "add_clip", "media_id": mid, "src_in": 0, "src_out": 3}]})
    assert client.post(f"/projects/{pid}/references", files={"file": ("notes.txt", b"hello", "text/plain")}).status_code == 400

    r = client.post(f"/projects/{pid}/references", files={"file": ("teal night.png", png((20, 70, 90)), "image/png")})
    assert r.status_code == 200, r.text
    [ref] = r.json()["references"]
    assert ref["name"] == "teal night" and client.get(ref["url"]).status_code == 200

    assert client.post(f"/projects/{pid}/grade", json={"reference_id": "ref_nope"}).status_code == 400
    r = client.post(f"/projects/{pid}/grade", json={"reference_id": ref["id"], "intensity": 0.9})
    assert r.status_code == 200, r.text
    assert r.json()["history"][-1]["label"] == "Color: Match teal night"
    graded = r.json()["timeline"]["clips"][0]["grade"]
    assert graded["temperature"] < 0  # pulled toward the teal still

    assert client.post(f"/projects/{pid}/runs", json={"instruction": "grade it", "reference_ids": ["ref_nope"]}).status_code == 400
    assert client.delete(f"/projects/{pid}/references/{ref['id']}").json()["references"] == []


def test_last_check_survives_a_reload(client: TestClient) -> None:
    from datetime import UTC, datetime

    import auteur.main as m
    from auteur.timeline.history import CheckMark, CheckResult

    pid = client.post("/projects", json={"name": "Checked"}).json()["id"]
    assert client.get(f"/projects/{pid}").json()["last_check"] is None
    p = m.store.get(pid)
    p.last_check = CheckResult(
        passed=False, issues=["Clip c1: subject leaves the frame"], marks=[CheckMark(start=1.0, end=2.5, label="Subject leaves frame")],
        render="renders/preview-1.mp4", run_id="run_x", head=None, at=datetime.now(UTC),
    )
    m.store.save(p)
    check = client.get(f"/projects/{pid}").json()["last_check"]
    assert check["passed"] is False
    assert check["marks"] == [{"start": 1.0, "end": 2.5, "label": "Subject leaves frame"}]
    assert check["head"] is None


def test_check_head_catches_undo_then_new_edit(client: TestClient, project: dict) -> None:
    """Undo plus a new edit keeps the history length the same; the head commit id must still change,
    or marks from the old check would look current."""
    pid, mid = project["id"], project["media"][0]["id"]

    def edit(label: str) -> dict:
        r = client.post(f"/projects/{pid}/ops", json={"label": label, "ops": [{"op": "add_clip", "media_id": mid, "src_in": 0, "src_out": 2}]})
        assert r.status_code == 200, r.text
        return r.json()

    edit("First")
    checked = edit("Second")["history"]
    head = checked[-1]["id"]  # what the render tool stores as last_check.head

    client.post(f"/projects/{pid}/undo")
    after = edit("Third")["history"]
    assert len(after) == len(checked)  # the length alone can't tell
    assert after[-1]["id"] != head  # the head can

    # Undo alone also moves the head.
    view = client.post(f"/projects/{pid}/undo").json()
    assert (view["history"][-1]["id"] if view["history"] else None) != head


def test_storyboard_edits_redraft_scenes_and_reorder_the_timeline(client: TestClient, sample_video: Path) -> None:
    import shutil as sh

    import auteur.main as m
    from auteur.media import ingest
    from auteur.motion import place_scenes
    from auteur.timeline.history import Storyboard, StoryScene

    pid = client.post("/projects", json={"name": "Promo"}).json()["id"]
    assert client.put(f"/projects/{pid}/storyboard", json={"style": "x", "scenes": [{"title": "a", "duration": 2, "brief": "b"}]}).status_code == 400

    p = m.store.get(pid)
    scenes = []
    for sid in ("s1", "s2"):
        copy = Path(m.settings.data_dir) / f"{sid}.mp4"
        sh.copy(sample_video, copy)
        media = ingest(m.store.project_dir(pid), f"media_{sid}", sid, copy).model_copy(update={"scene_id": sid})
        p.media[media.id] = media
        scenes.append(StoryScene(id=sid, title=sid, duration=4, brief=f"brief {sid}", code="//", media_id=media.id, status="ready"))
    p.storyboard = Storyboard(brief="promo", style="dark", scenes=scenes)
    p.commit("agent", "place", place_scenes(p.timeline, p.media, p.storyboard))
    m.store.save(p)

    body = {"style": "dark", "scenes": [
        {"id": "s2", "title": "s2", "duration": 4, "brief": "brief s2"},
        {"id": "s1", "title": "s1", "duration": 4, "brief": "a sharper headline"},
    ]}
    view = client.put(f"/projects/{pid}/storyboard", json=body).json()
    assert [s["status"] for s in view["storyboard"]["scenes"]] == ["ready", "draft"]
    assert [c["media_id"] for c in view["timeline"]["clips"]] == ["media_s2", "media_s1"]
    assert view["history"][-1]["label"] == "Storyboard order"

    too_long = {"style": "dark", "scenes": [{"title": f"t{i}", "duration": 20, "brief": "b"} for i in range(10)]}
    assert client.put(f"/projects/{pid}/storyboard", json=too_long).status_code == 400


def _wait_export(client: TestClient, pid: str) -> dict:
    import time

    for _ in range(300):
        export = client.get(f"/projects/{pid}").json()["export"]
        if export["status"] != "running":
            return export
        time.sleep(0.1)
    raise AssertionError("export never finished")


def _probe(path: Path) -> str:
    import subprocess

    return subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,width,height,r_frame_rate", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def test_exports_mp4_gif_and_mp3_at_the_requested_settings(client: TestClient, project: dict) -> None:
    with client:  # one event loop for the whole test, so the export task keeps running
        import auteur.main as m

        pid, mid = project["id"], project["media"][0]["id"]
        assert client.post(f"/projects/{pid}/exports", json={}).status_code == 400  # empty timeline
        client.post(f"/projects/{pid}/ops", json={"label": "Add", "ops": [{"op": "add_clip", "media_id": mid, "src_in": 0, "src_out": 2}]})

        started = client.post(f"/projects/{pid}/exports", json={"resolution": 480, "quality": "draft", "fps": 24}).json()
        assert started["status"] == "running"
        done = _wait_export(client, pid)
        assert done["status"] == "done" and done["progress"] == 1 and done["url"].endswith(".mp4")
        out = m.settings.data_dir / "projects" / pid / done["url"].split(f"/files/{pid}/")[1]
        assert _probe(out).splitlines() == ["h264,854,480,24/1", "aac,0/0"]
        assert client.get(f"/projects/{pid}").json()["last_render_url"] == done["url"]

        client.post(f"/projects/{pid}/exports", json={"format": "gif", "resolution": 360})
        gif = _wait_export(client, pid)
        assert gif["status"] == "done" and gif["url"].endswith(".gif")
        assert client.get(gif["url"]).headers["content-type"] == "image/gif"

        client.post(f"/projects/{pid}/exports", json={"format": "mp3"})
        mp3 = _wait_export(client, pid)
        assert mp3["status"] == "done" and mp3["url"].endswith(".mp3")

        assert client.post(f"/projects/{pid}/exports", json={"format": "gif", "resolution": 1080}).status_code == 400


def test_an_export_can_be_cancelled(client: TestClient, project: dict, monkeypatch) -> None:
    with client:  # one event loop for the whole test, so the export task keeps running
        import threading

        import auteur.exporter as ex

        gate = threading.Event()
        real = ex.render

        def slow_render(*args, **kwargs):
            gate.wait(5)  # hold the export until the cancel request is in
            return real(*args, **kwargs)

        monkeypatch.setattr(ex, "render", slow_render)
        pid, mid = project["id"], project["media"][0]["id"]
        client.post(f"/projects/{pid}/ops", json={"label": "Add", "ops": [{"op": "add_clip", "media_id": mid, "src_in": 0, "src_out": 2}]})
        job = client.post(f"/projects/{pid}/exports", json={"resolution": 360}).json()
        assert client.post(f"/projects/{pid}/exports", json={}).status_code == 409  # one at a time
        assert client.post(f"/projects/{pid}/exports/{job['id']}/cancel").json() == {"cancelled": True}
        gate.set()
        assert _wait_export(client, pid)["status"] == "cancelled"


def test_pictures_and_gifs_become_video_clips(client: TestClient, tmp_path: Path) -> None:
    import subprocess

    from PIL import Image

    pid = client.post("/projects", json={"name": "Pictures"}).json()["id"]
    png = tmp_path / "logo.png"
    im = Image.new("RGBA", (501, 301), (0, 0, 0, 0))  # odd size and transparent: must still encode
    im.paste((198, 255, 62, 255), (100, 100, 400, 200))
    im.save(png)
    with png.open("rb") as f:
        view = client.post(f"/projects/{pid}/media", files={"file": ("logo.png", f, "image/png")}).json()
    [still] = view["media"]
    assert (still["image"], still["kind"], still["has_audio"]) == ("still", "video", False)
    assert (still["width"], still["height"]) == (500, 300) and still["duration"] == pytest.approx(60, abs=0.1)

    gif = tmp_path / "spin.gif"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=1.2",
                    str(gif)], check=True)
    with gif.open("rb") as f:
        view = client.post(f"/projects/{pid}/media", files={"file": ("spin.gif", f, "image/gif")}).json()
    looped = next(m for m in view["media"] if m["image"] == "gif")
    assert looped["duration"] >= 5  # 1.2s looped whole until at least 5s

    # Pictures don't eat the footage budget, and they edit like any clip.
    r = client.post(f"/projects/{pid}/ops", json={"label": "Add", "ops": [
        {"op": "add_clip", "media_id": still["id"], "src_in": 0, "src_out": 4},
        {"op": "add_clip", "media_id": looped["id"], "src_in": 0, "src_out": 2},
    ]})
    assert r.status_code == 200 and r.json()["timeline"]["clips"][0]["src_out"] == 4

    broken = tmp_path / "broken.png"
    broken.write_bytes(b"not a picture")
    with broken.open("rb") as f:
        assert client.post(f"/projects/{pid}/media", files={"file": ("broken.png", f, "image/png")}).status_code == 400


def test_a_4_5_project_exports_portrait(client: TestClient, project: dict) -> None:
    import auteur.main as m

    with client:
        pid, mid = project["id"], project["media"][0]["id"]
        client.post(f"/projects/{pid}/ops", json={"label": "Feed", "ops": [
            {"op": "set_aspect", "aspect": "4:5"}, {"op": "add_clip", "media_id": mid, "src_in": 0, "src_out": 1},
        ]})
        client.post(f"/projects/{pid}/exports", json={"resolution": 480, "quality": "draft"})
        done = _wait_export(client, pid)
        out = m.settings.data_dir / "projects" / pid / done["url"].split(f"/files/{pid}/")[1]
        assert _probe(out).splitlines()[0].startswith("h264,480,600,")


def test_import_from_a_link(client: TestClient, sample_video: Path, monkeypatch) -> None:
    import shutil as sh

    import auteur.main as m

    pid = client.post("/projects", json={"name": "Links"}).json()["id"]
    r = client.post(f"/projects/{pid}/media/link", json={"url": "http://127.0.0.1:8000/projects"})
    assert r.status_code == 400 and "private or local" in r.json()["detail"]

    def fake_download(url: str, dest: Path) -> Path:
        out = dest / "beach.mp4"
        sh.copy(sample_video, out)
        return out

    monkeypatch.setattr(m.fetch, "download", fake_download)
    view = client.post(f"/projects/{pid}/media/link", json={"url": "https://cdn.example.com/beach"}).json()
    assert [x["name"] for x in view["media"]] == ["beach.mp4"]


def test_export_at_a_set_bitrate(client: TestClient, project: dict) -> None:
    import subprocess

    import auteur.main as m

    with client:
        pid, mid = project["id"], project["media"][0]["id"]
        client.post(f"/projects/{pid}/ops", json={"label": "Add", "ops": [{"op": "add_clip", "media_id": mid, "src_in": 0, "src_out": 4}]})
        for mbps in (1, 6):
            client.post(f"/projects/{pid}/exports", json={"resolution": 720, "mbps": mbps})
            done = _wait_export(client, pid)
            assert done["mbps"] == mbps
            out = m.settings.data_dir / "projects" / pid / done["url"].split(f"/files/{pid}/")[1]
            rate = int(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=bit_rate",
                                       "-of", "csv=p=0", str(out)], capture_output=True, text=True, check=True).stdout)
            assert 0.6 * mbps * 1e6 < rate < 1.4 * mbps * 1e6, (mbps, rate)


def test_clip_sound_fades_detaches_and_has_a_waveform(client: TestClient, project: dict) -> None:
    pid, mid = project["id"], project["media"][0]["id"]
    assert project["media"][0]["waveform_url"].endswith("/waveform.png")
    assert client.get(project["media"][0]["waveform_url"]).headers["content-type"] == "image/png"
    view = client.post(f"/projects/{pid}/ops", json={"label": "Add", "ops": [
        {"op": "add_clip", "id": "c1", "media_id": mid, "src_in": 0.5, "src_out": 3.5},
        {"op": "set_audio_fade", "clip_id": "c1", "fade_in": 0.5, "fade_out": 1},
    ]}).json()
    assert (view["timeline"]["clips"][0]["audio_fade_in"], view["timeline"]["clips"][0]["audio_fade_out"]) == (0.5, 1)
    view = client.post(f"/projects/{pid}/ops", json={"label": "Detach", "ops": [{"op": "detach_audio", "clip_id": "c1"}]}).json()
    [sound] = view["timeline"]["audio"]
    assert view["timeline"]["clips"][0]["muted"] is True
    assert (sound["media_id"], sound["src_in"], sound["src_out"], sound["start"], sound["duck"]) == (mid, 0.5, 3.5, 0, False)
    assert (sound["fade_in"], sound["fade_out"]) == (0.5, 1)
    again = client.post(f"/projects/{pid}/ops", json={"label": "Detach", "ops": [{"op": "detach_audio", "clip_id": "c1"}]})
    assert again.status_code == 400  # already muted: nothing left to detach


def test_lut_upload_and_use_through_the_api(client: TestClient, project: dict, tmp_path: Path) -> None:
    pid, mid = project["id"], project["media"][0]["id"]
    from auteur import derived

    cube = derived.write_cube(2, 1 - derived.identity(2), tmp_path / "Invert.cube")
    with cube.open("rb") as f:
        view = client.post(f"/projects/{pid}/luts", files={"file": ("Invert.cube", f, "text/plain")}).json()
    [lut] = view["luts"]
    assert (lut["name"], lut["size"]) == ("Invert", 2)
    bad = client.post(f"/projects/{pid}/ops", json={"label": "x", "ops": [
        {"op": "add_clip", "id": "c1", "media_id": mid, "src_in": 0, "src_out": 2},
        {"op": "set_lut", "clip_id": "c1", "lut": {"lut_id": "lut_nope", "intensity": 1}},
    ]})
    assert bad.status_code == 400 and "Unknown LUTs" in bad.json()["detail"]
    view = client.post(f"/projects/{pid}/ops", json={"label": "x", "ops": [
        {"op": "add_clip", "id": "c1", "media_id": mid, "src_in": 0, "src_out": 2},
        {"op": "set_lut", "clip_id": "c1", "lut": {"lut_id": lut["id"], "intensity": 0.5}},
        {"op": "set_reverse", "clip_id": "c1", "reverse": True},
    ]}).json()
    assert "c1" in view["clip_previews"]  # a variant is (being) prepared for the editor
    assert client.delete(f"/projects/{pid}/luts/{lut['id']}").status_code == 400  # still in use
    with (tmp_path / "x.cube").open("w") as f:
        f.write("LUT_1D_SIZE 4\n")
    with (tmp_path / "x.cube").open("rb") as f:
        assert client.post(f"/projects/{pid}/luts", files={"file": ("x.cube", f, "text/plain")}).status_code == 400


def test_freeze_frame_holds_the_moment(client: TestClient, project: dict) -> None:
    pid, mid = project["id"], project["media"][0]["id"]
    client.post(f"/projects/{pid}/ops", json={"label": "Add", "ops": [
        {"op": "add_clip", "id": "c1", "media_id": mid, "src_in": 0, "src_out": 4},
        {"op": "set_transform", "clip_id": "c1", "transform": {"scale": 0.8}},
    ]})
    view = client.post(f"/projects/{pid}/clips/c1/freeze", json={"at": 1.5, "duration": 2}).json()
    first, held, rest = view["timeline"]["clips"]
    still = next(m for m in view["media"] if m["id"] == held["media_id"])
    assert (first["src_out"], rest["src_in"]) == (1.5, 1.5)  # split at the frame
    assert (still["image"], held["src_out"], held["transform"]["scale"]) == ("still", 2, 0.8)
    assert view["history"][-1]["label"] == "Freeze frame 2s"
    assert client.post(f"/projects/{pid}/clips/c1/freeze", json={"at": 9, "duration": 2}).status_code == 400


def test_edit_by_transcript(client: TestClient, project: dict) -> None:
    import auteur.main as m
    from auteur.transcript import Transcript, Turn, Word

    pid, mid = project["id"], project["media"][0]["id"]
    client.post(f"/projects/{pid}/ops", json={"label": "Add", "ops": [{"op": "add_clip", "id": "c1", "media_id": mid, "src_in": 0, "src_out": 4}]})
    assert client.get(f"/projects/{pid}/transcript").json()["missing"] == [mid]

    words = [("So", 0.2, 0.4), ("um", 0.5, 0.8), ("this", 1.0, 1.3), ("is", 1.4, 1.6), ("great", 1.7, 2.2), ("okay", 2.8, 3.2)]
    t = Transcript(duration=4, silences=[], turns=[Turn(start=0.2, end=3.2, text="So um this is great okay",
                                                        words=[Word(text=w, start=a, end=b) for w, a, b in words])])
    (m.store.project_dir(pid) / "media" / mid / "transcript.json").write_text(t.model_dump_json())
    view = client.get(f"/projects/{pid}/transcript").json()
    [clip] = view["clips"]
    assert [w["text"] for w in clip["words"]] == [w for w, *_ in words] and clip["words"][1]["filler"] is True

    # Delete "um" and "this is" (two runs): the clip loses 0.3 + 0.6 seconds and the words go too.
    r = client.post(f"/projects/{pid}/transcript/cut", json={"cuts": [
        {"clip_id": "c1", "src_start": 0.5, "src_end": 0.8},
        {"clip_id": "c1", "src_start": 1.0, "src_end": 1.3}, {"clip_id": "c1", "src_start": 1.3, "src_end": 1.6},
    ]})
    assert r.status_code == 200, r.text
    tl = r.json()["timeline"]
    assert sum(c["src_out"] - c["src_in"] for c in tl["clips"]) == pytest.approx(4 - 0.3 - 0.6, abs=0.01)
    left = [w["text"] for c in client.get(f"/projects/{pid}/transcript").json()["clips"] for w in c["words"]]
    assert left == ["So", "great", "okay"]


def test_generate_image_adds_a_still(client: TestClient, monkeypatch, tmp_path: Path) -> None:
    import base64
    import io
    from types import SimpleNamespace

    from PIL import Image

    import auteur.imagegen as ig

    buf = io.BytesIO()
    Image.new("RGB", (1792, 1024), (240, 120, 40)).save(buf, "PNG")
    seen = {}

    class FakeImages:
        def generate(self, **kw):
            seen.update(kw)
            return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(buf.getvalue()).decode())])

    monkeypatch.setattr(ig, "OpenAI", lambda **kw: SimpleNamespace(images=FakeImages()))
    pid = client.post("/projects", json={"name": "Gen"}).json()["id"]
    client.post(f"/projects/{pid}/ops", json={"label": "9:16", "ops": [{"op": "set_aspect", "aspect": "9:16"}]})
    view = client.post(f"/projects/{pid}/media/generate", json={"prompt": "a clapperboard on orange"}).json()
    [m] = view["media"]
    assert (m["image"], m["name"]) == ("still", "Generated: a clapperboard on orange")
    assert (seen["model"], seen["size"]) == ("muse-image-1.0", "1024x1792")  # the project's aspect
    assert view["spent"] == pytest.approx(0.01)


def test_translate_subtitles_rewraps_and_respreads_words(client: TestClient, monkeypatch) -> None:
    import auteur.translate as tr

    async def fake(lines, language):
        return [f"[{language}] {ln}" for ln in lines], 0.002

    monkeypatch.setattr(tr, "translate_lines", fake)
    pid = client.post("/projects", json={"name": "Translate"}).json()["id"]
    client.post(f"/projects/{pid}/ops", json={"label": "Subs", "ops": [
        {"op": "add_text", "id": "s1", "text": "Hello\nworld", "start": 0, "end": 2,
         "words": [{"text": "Hello", "start": 0, "end": 1}, {"text": "world", "start": 1, "end": 2}]},
        {"op": "add_text", "id": "t1", "text": "Title", "start": 0, "end": 2, "style": "title"},
    ]})
    view = client.post(f"/projects/{pid}/texts/translate", json={"language": "Indonesian"}).json()
    sub = next(t for t in view["timeline"]["texts"] if t["id"] == "s1")
    title = next(t for t in view["timeline"]["texts"] if t["id"] == "t1")
    assert sub["text"].replace("\n", " ") == "[Indonesian] Hello world"  # one line from the joined original
    assert [w["text"] for w in sub["words"]] == ["[Indonesian]", "Hello", "world"]
    assert sub["words"][-1]["end"] == pytest.approx(2)
    assert title["text"] == "Title"  # subtitles only
    assert view["history"][-1]["label"] == "Translate to Indonesian" and view["spent"] == pytest.approx(0.002)


def _fake_speech(monkeypatch, seconds_per_word: float = 0.4) -> None:
    import numpy as np

    import auteur.tts as tts

    def speak(text, language):
        n = int(len(text.split()) * seconds_per_word * tts.SAMPLE_RATE)
        return (0.3 * np.sin(np.arange(n) * 2 * np.pi * 220 / tts.SAMPLE_RATE)).astype(np.float32)

    monkeypatch.setattr(tts, "speak", speak)


def test_voiceover_goes_on_the_music_track(client: TestClient, project: dict, monkeypatch) -> None:
    _fake_speech(monkeypatch)
    pid = project["id"]
    view = client.post(f"/projects/{pid}/voiceover", json={"text": "one two three four five", "language": "English", "at": 1.5}).json()
    voice = next(m for m in view["media"] if m["name"].startswith("Voice:"))
    [item] = view["timeline"]["audio"]
    assert voice["kind"] == "audio" and voice["duration"] == pytest.approx(2.0, abs=0.05)
    assert (item["media_id"], item["start"], item["duck"]) == (voice["id"], 1.5, False)
    bad = client.post(f"/projects/{pid}/voiceover", json={"text": "hola", "language": "Klingon"})
    assert bad.status_code == 400 and "No voice" in bad.json()["detail"]


def test_dub_speaks_translated_subtitles_over_quieter_sound(client: TestClient, project: dict, monkeypatch) -> None:
    import auteur.translate as tr

    _fake_speech(monkeypatch, 0.3)

    async def fake_translate(lines, language):
        return [f"halo {ln}" for ln in lines], 0.001

    monkeypatch.setattr(tr, "translate_lines", fake_translate)
    pid, mid = project["id"], project["media"][0]["id"]
    assert client.post(f"/projects/{pid}/dub", json={"language": "Indonesian"}).status_code == 400  # no subtitles yet
    client.post(f"/projects/{pid}/ops", json={"label": "x", "ops": [
        {"op": "add_clip", "id": "c1", "media_id": mid, "src_in": 0, "src_out": 4},
        {"op": "add_text", "id": "s1", "text": "hello there", "start": 0.5, "end": 1.8},
        {"op": "add_text", "id": "s2", "text": "how are you", "start": 2.0, "end": 3.5},
    ]})
    view = client.post(f"/projects/{pid}/dub", json={"language": "Indonesian"}).json()
    [dub] = view["timeline"]["audio"]
    assert next(m for m in view["media"] if m["id"] == dub["media_id"])["duration"] == pytest.approx(4, abs=0.05)
    assert view["timeline"]["clips"][0]["volume"] == pytest.approx(0.15)
    assert [t["text"] for t in view["timeline"]["texts"]] == ["halo hello there", "halo how are you"]
    assert view["history"][-1]["label"] == "Dub into Indonesian"


def test_dub_track_fits_lines_into_their_slots(tmp_path: Path, monkeypatch) -> None:
    import wave

    import numpy as np

    import auteur.tts as tts

    _fake_speech(monkeypatch, 0.5)
    # 4 words = 2s of speech in a 1.5s slot: sped up 1.33x so it ends before the next line.
    out = tts.dub_track([(0.5, 1.5, "a b c d"), (2.0, 2.5, "e")], "English", "natural", 3.0, tmp_path / "dub.wav")
    with wave.open(str(out)) as w:
        samples = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float)
    sr = tts.SAMPLE_RATE
    loud = lambda a, b: np.abs(samples[int(a * sr): int(b * sr)]).max() > 1000  # noqa: E731
    assert not loud(0, 0.45) and loud(0.55, 0.65)
    assert not loud(1.93, 1.99)  # the first line finished (with a breath) before the second
    assert loud(2.05, 2.15)


def test_remove_background_masks_once_and_bills_sam(client: TestClient, project: dict, monkeypatch) -> None:
    import auteur.masks as mk

    calls = []

    async def fake_mask(project_dir, media_id, prompt, keep, on_progress=None):
        calls.append((media_id, prompt, keep))
        return mk.mask_path(project_dir, media_id, prompt, keep), 0 if len(calls) > 1 else 150

    monkeypatch.setattr(mk, "make_mask", fake_mask)
    pid, mid = project["id"], project["media"][0]["id"]
    added = client.post(f"/projects/{pid}/ops", json={"label": "Add", "ops": [{"op": "add_clip", "media_id": mid, "src_in": 0, "src_out": 3}]})
    cid = added.json()["timeline"]["clips"][0]["id"]
    body = {"prompt": "dog", "keep": "all", "backdrop": {"kind": "color", "color": "#112233"}}
    view = client.post(f"/projects/{pid}/clips/{cid}/remove-background", json=body).json()
    bg = view["timeline"]["clips"][0]["bg_remove"]
    assert (bg["prompt"], bg["keep"], bg["backdrop"]["color"]) == ("dog", "all", "#112233")
    assert view["spent"] == pytest.approx(150 * 0.2 / 1000)
    assert view["history"][-1]["label"] == "Remove background"
    again = client.post(f"/projects/{pid}/clips/{cid}/remove-background", json=body).json()
    assert again["spent"] == pytest.approx(view["spent"])  # a cached mask costs nothing
    reversed_ = client.post(f"/projects/{pid}/ops", json={"label": "Reverse", "ops": [{"op": "set_reverse", "clip_id": cid, "reverse": True}]})
    assert reversed_.status_code == 400
    assert client.post(f"/projects/{pid}/clips/nope/remove-background", json=body).status_code == 404
