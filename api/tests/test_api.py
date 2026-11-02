from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from auteur.main import app, project_lock


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


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
    lock = project_lock(project["id"])
    await lock.acquire()
    try:
        r = client.post(f"/projects/{project['id']}/undo")
        assert r.status_code == 409
        assert client.get(f"/projects/{project['id']}").json()["busy"] is True
    finally:
        lock.release()


def test_run_quota_per_visitor() -> None:
    import auteur.main as main

    # Settings is a frozen dataclass read at import; flip the guard on just for this test.
    object.__setattr__(main.settings, "runs_per_visitor_per_day", 1)
    try:
        req = type("R", (), {"client": type("C", (), {"host": "1.2.3.4"})()})()
        main.check_run_quota(req)
        with pytest.raises(main.HTTPException) as e:
            main.check_run_quota(req)
        assert e.value.status_code == 429
    finally:
        object.__setattr__(main.settings, "runs_per_visitor_per_day", 0)
