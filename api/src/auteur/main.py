import asyncio
import json
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from auteur.agent.loop import run_agent
from auteur.config import settings
from auteur.events import bus
from auteur.media import MAX_TOTAL_SECONDS, MediaError, ingest
from auteur.render import RenderError, render
from auteur.store import NotFound, Store
from auteur.timeline import Media, Op, OpError, Project, Timeline
from auteur.timeline.history import ChatMessage
from auteur.tracking import load_track
from auteur.timeline.ops import new_id

app = FastAPI(title="Auteur Labs API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = Store(settings.data_dir)
(settings.data_dir / "projects").mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=settings.data_dir / "projects"), name="files")

# One lock per project serializes edits; an agent run holds it for the whole run.
_locks: dict[str, asyncio.Lock] = {}
_runs: dict[str, tuple[str, asyncio.Task]] = {}


def project_lock(project_id: str) -> asyncio.Lock:
    return _locks.setdefault(project_id, asyncio.Lock())


class CommitView(BaseModel):
    id: str
    author: Literal["agent", "user"]
    label: str
    run_id: str | None
    at: datetime


class MediaView(Media):
    preview_url: str
    thumb_url: str
    filmstrip_url: str | None


class TrackView(BaseModel):
    id: str
    media_id: str
    prompt: str
    url: str


class ProjectView(BaseModel):
    """What the editor needs: everything except the timeline snapshots stored in history."""

    id: str
    name: str
    media: list[MediaView]
    timeline: Timeline
    history: list[CommitView]
    chat: list[ChatMessage]
    tracks: list[TrackView]
    last_render_url: str | None
    can_undo: bool
    can_redo: bool
    busy: bool

    @classmethod
    def of(cls, p: Project) -> "ProjectView":
        base = f"/files/{p.id}/media"
        return cls(
            id=p.id,
            name=p.name,
            media=[
                MediaView(
                    **m.model_dump(),
                    preview_url=f"{base}/{m.id}/preview.mp4",
                    thumb_url=f"{base}/{m.id}/thumb.jpg",
                    filmstrip_url=(
                        f"{base}/{m.id}/filmstrip.jpg"
                        if (store.project_dir(p.id) / "media" / m.id / "filmstrip.jpg").exists() else None
                    ),
                )
                for m in p.media.values()
            ],
            timeline=p.timeline,
            history=[CommitView(**c.model_dump(include=set(CommitView.model_fields))) for c in p.history],
            chat=p.chat,
            tracks=[
                TrackView(id=t.id, media_id=t.media_id, prompt=t.prompt, url=f"/files/{p.id}/tracks/{t.id}.json")
                for t in p.tracks.values()
            ],
            last_render_url=f"/files/{p.id}/{p.last_render}" if p.last_render else None,
            can_undo=bool(p.history),
            can_redo=bool(p.redo_stack),
            busy=project_lock(p.id).locked(),
        )


class CreateProject(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class RenderRequest(BaseModel):
    final: bool = True


class RunRequest(BaseModel):
    instruction: str = Field(min_length=1, max_length=2000)


class OpsRequest(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    ops: list[Op] = Field(min_length=1)


def load(project_id: str) -> Project:
    try:
        return store.get(project_id)
    except NotFound:
        raise HTTPException(404, f"Project {project_id} not found") from None


def ensure_idle(project_id: str) -> asyncio.Lock:
    lock = project_lock(project_id)
    if lock.locked():
        raise HTTPException(409, "The agent is editing this project; stop the run or wait for it to finish")
    return lock


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/projects")
def list_projects() -> list[dict[str, str]]:
    return store.list()


@app.post("/projects")
def create_project(body: CreateProject) -> ProjectView:
    return ProjectView.of(store.create(body.name))


@app.get("/projects/{project_id}")
def get_project(project_id: str) -> ProjectView:
    return ProjectView.of(load(project_id))


@app.post("/projects/{project_id}/media")
async def upload_media(project_id: str, file: UploadFile) -> ProjectView:
    async with ensure_idle(project_id):
        p = load(project_id)
        suffix = Path(file.filename or "upload.mp4").suffix
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=settings.data_dir) as tmp:
            shutil.copyfileobj(file.file, tmp)
        media_id = new_id("media")
        try:
            media = await asyncio.to_thread(
                ingest, store.project_dir(p.id), media_id, file.filename or media_id, Path(tmp.name)
            )
        except MediaError as e:
            shutil.rmtree(store.project_dir(p.id) / "media" / media_id, ignore_errors=True)
            raise HTTPException(400, f"Could not read video: {e}") from None
        finally:
            Path(tmp.name).unlink(missing_ok=True)

        total = sum(m.duration for m in p.media.values()) + media.duration
        if total > MAX_TOTAL_SECONDS:
            shutil.rmtree(store.project_dir(p.id) / "media" / media_id, ignore_errors=True)
            raise HTTPException(400, f"Project footage would be {total:.0f}s; the limit is {MAX_TOTAL_SECONDS}s")
        p.media[media.id] = media
        store.save(p)
        return ProjectView.of(p)


@app.post("/projects/{project_id}/ops")
async def apply_ops(project_id: str, body: OpsRequest) -> ProjectView:
    async with ensure_idle(project_id):
        p = load(project_id)
        try:
            p.commit("user", body.label, body.ops)
        except OpError as e:
            raise HTTPException(400, str(e)) from None
        store.save(p)
        return ProjectView.of(p)


@app.post("/projects/{project_id}/undo")
async def undo(project_id: str) -> ProjectView:
    async with ensure_idle(project_id):
        p = load(project_id)
        p.undo()
        store.save(p)
        return ProjectView.of(p)


@app.post("/projects/{project_id}/redo")
async def redo(project_id: str) -> ProjectView:
    async with ensure_idle(project_id):
        p = load(project_id)
        p.redo()
        store.save(p)
        return ProjectView.of(p)


@app.post("/projects/{project_id}/runs")
async def start_run(project_id: str, body: RunRequest) -> dict[str, str]:
    load(project_id)
    lock = ensure_idle(project_id)
    if (run := _runs.get(project_id)) and not run[1].done():
        raise HTTPException(409, "The agent is already running")
    run_id = new_id("run")
    task = asyncio.create_task(run_agent(store, project_id, run_id, body.instruction, lock))
    _runs[project_id] = (run_id, task)
    return {"run_id": run_id}


@app.post("/projects/{project_id}/runs/stop")
async def stop_run(project_id: str) -> dict[str, bool]:
    run = _runs.get(project_id)
    if run is None or run[1].done():
        return {"stopped": False}
    run[1].cancel()
    return {"stopped": True}


@app.post("/projects/{project_id}/runs/{run_id}/undo")
async def undo_run(project_id: str, run_id: str) -> ProjectView:
    """Undo every edit of an agent instruction ("batalkan arahan terakhir")."""
    async with ensure_idle(project_id):
        p = load(project_id)
        if p.undo_run(run_id) == 0:
            raise HTTPException(400, "That instruction has no edits at the top of the history to undo")
        store.save(p)
        return ProjectView.of(p)


@app.get("/projects/{project_id}/events")
async def events(project_id: str) -> EventSourceResponse:
    load(project_id)

    async def stream():
        q = bus.subscribe(project_id)
        try:
            while True:
                event = await q.get()
                if event["type"] in ("timeline", "track", "run_finished"):
                    # Ship the fresh project with the event so the editor redraws without refetching.
                    view = ProjectView.of(store.get(project_id))
                    if event["type"] == "run_finished":
                        view.busy = False  # the run may still be releasing the lock
                    event = {**event, "project": json.loads(view.model_dump_json())}
                yield {"event": event["type"], "data": json.dumps(event)}
        finally:
            bus.unsubscribe(project_id, q)

    return EventSourceResponse(stream(), ping=15)


@app.post("/projects/{project_id}/render")
async def export(project_id: str, body: RenderRequest) -> ProjectView:
    """Manual export from the editor's Export button (the agent renders through its own tool)."""
    async with ensure_idle(project_id):
        p = load(project_id)
        renders = store.project_dir(p.id) / "renders"
        n = len(list(renders.glob("*.mp4"))) if renders.exists() else 0
        rel = f"renders/{'final' if body.final else 'preview'}-{n + 1}.mp4"
        tracks = {
            e.track_id: load_track(store.project_dir(p.id), e.track_id) for c in p.timeline.clips for e in c.effects
        }
        try:
            await asyncio.to_thread(
                render, p.timeline, p.media, store.project_dir(p.id) / rel, 1.0 if body.final else 0.5, None, tracks
            )
        except RenderError as e:
            raise HTTPException(400, str(e)) from None
        p.last_render = rel
        store.save(p)
        return ProjectView.of(p)
