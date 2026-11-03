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
