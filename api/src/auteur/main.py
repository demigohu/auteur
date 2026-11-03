import asyncio
import json
import re
import shutil
from datetime import date
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.types import ASGIApp, Receive, Scope, Send
from sse_starlette.sse import EventSourceResponse

from auteur import colorist, motion, reference
from auteur.agent.loop import run_agent, run_tool
from auteur.config import settings
from auteur.events import bus
from auteur.media import MAX_TOTAL_SECONDS, MediaError, ingest
from auteur.render import RenderError, render
from auteur.auth import ClerkAuth
from auteur.store import NotFound, Store
from auteur.timeline import Media, Op, OpError, Project, Timeline
from auteur.timeline.history import ChatMessage, CheckResult, ReferenceImage, Storyboard
from auteur.tracking import load_track
from auteur.timeline.models import Aspect
from auteur.timeline.ops import SetGrade, new_id

# Everything else needs a signed-in account. Media files stay public: their project ids are unguessable
# and <video> elements cannot attach credentials cross-origin anyway.
PUBLIC_PATHS = ("/health", "/files/", "/looks", "/docs", "/openapi.json")

app = FastAPI(title="Auteur Labs API")
store = Store(settings.data_dir)
clerk = (
    ClerkAuth(settings.clerk_publishable_key, settings.cors_origins, settings.clerk_jwks_url)
    if settings.clerk_publishable_key
    else None
)


def session_token(request: Request) -> str | None:
    """Bearer token from fetches, or Clerk's `__session` cookie from the event stream."""
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return request.cookies.get("__session")


class RequireAccount:
    """Plain ASGI middleware (not BaseHTTPMiddleware, which buffers the agent's event stream): every
    non-public request needs a Clerk session, and /projects/{id}/... must belong to that account."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] == "OPTIONS" or scope["path"].startswith(PUBLIC_PATHS):
            return await self.app(scope, receive, send)
        if clerk is None:
            detail = "Accounts are not configured: set CLERK_PUBLISHABLE_KEY in api/.env"
            return await JSONResponse({"detail": detail}, 503)(scope, receive, send)
        # Verification may fetch Clerk's signing keys (cached for an hour), so keep it off the event loop.
        account = await run_in_threadpool(clerk.user_id, session_token(Request(scope)))
        if account is None:
            return await JSONResponse({"detail": "Sign in to continue"}, 401)(scope, receive, send)
        store.seen(account)
        if m := re.match(r"^/projects/([^/]+)", scope["path"]):
            try:
                owner = store.owner(m[1])
            except NotFound:
                owner = None
            if owner != account:
                return await JSONResponse({"detail": f"Project {m[1]} not found"}, 404)(scope, receive, send)
        scope.setdefault("state", {})["account"] = account
        await self.app(scope, receive, send)


# Added before CORS so CORS wraps it and even a 401 carries the headers the browser needs to read it.
app.add_middleware(RequireAccount)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

(settings.data_dir / "projects").mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=settings.data_dir / "projects"), name="files")

# One lock per project serializes edits; an agent run holds it for the whole run.
_locks: dict[str, asyncio.Lock] = {}
_runs: dict[str, tuple[str, asyncio.Task]] = {}
_visitor_runs: dict[tuple[str, date], int] = {}


def check_run_quota(request: Request) -> None:
    """Spend guards (each off unless configured): a global cap, a cap per account, and runs per visitor
    per day."""
    if settings.spend_cap_usd and store.total_spent() >= settings.spend_cap_usd:
        raise HTTPException(429, "Today's demo budget is used up. Try again tomorrow, or run Auteur locally.")
    if settings.user_spend_cap_usd and store.spent_by(request.state.account) >= settings.user_spend_cap_usd:
        raise HTTPException(429, f"This account has used its ${settings.user_spend_cap_usd:.2f} of agent runs. Manual editing still works.")
    if settings.runs_per_visitor_per_day:
        key = (request.client.host if request.client else "unknown", date.today())
        if _visitor_runs.get(key, 0) >= settings.runs_per_visitor_per_day:
            raise HTTPException(
                429, f"The demo allows {settings.runs_per_visitor_per_day} instructions per day. Thanks for trying Auteur."
            )
        _visitor_runs[key] = _visitor_runs.get(key, 0) + 1


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
    beats: list[float] | None = None


def timeline_speech(p: Project) -> list[tuple[float, float]]:
    """Timeline ranges where someone speaks, from cached transcripts; the preview ducks music there
    (the export uses a sidechain compressor, which needs no ranges)."""
    from auteur.transcript import Transcript

    out = []
    for c, start in zip(p.timeline.clips, p.timeline.clip_starts()):
        cache = store.project_dir(p.id) / "media" / c.media_id / "transcript.json"
        if not c.has_sound or not cache.exists():
            continue
        for turn in Transcript.model_validate_json(cache.read_text()).turns:
            a, b = max(turn.start, c.src_in), min(turn.end, c.src_out)
            if b > a:
                out.append((round(start + c.to_local(a), 2), round(start + c.to_local(b), 2)))
    return out


def media_beats(p: Project, m: Media) -> list[float] | None:
    f = store.project_dir(p.id) / "media" / m.id / "beats.json"
    return json.loads(f.read_text())["beats"] if m.kind == "audio" and f.exists() else None


class TrackView(BaseModel):
    id: str
    media_id: str
    prompt: str
    url: str


class ReferenceView(BaseModel):
    id: str
    name: str
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
    references: list[ReferenceView]
    last_check: CheckResult | None
    storyboard: Storyboard | None
    speech: list[tuple[float, float]]
    spent: float
    last_render_url: str | None
    can_undo: bool
    can_redo: bool
    busy: bool

    @classmethod
    def of(cls, p: Project, busy: bool | None = None) -> "ProjectView":
        """`busy=False` from handlers that hold the project lock themselves: their own lock is not
        the agent running, and reporting it would make the editor lock the timeline."""
        base = f"/files/{p.id}/media"
        return cls(
            id=p.id,
            name=p.name,
            media=[
                MediaView(
                    **m.model_dump(),
                    preview_url=f"{base}/{m.id}/preview.{'m4a' if m.kind == 'audio' else 'mp4'}",
                    thumb_url=f"{base}/{m.id}/{'filmstrip.png' if m.kind == 'audio' else 'thumb.jpg'}",
                    filmstrip_url=next(
                        (f"{base}/{m.id}/{name}" for name in ("filmstrip.jpg", "filmstrip.png")
                         if (store.project_dir(p.id) / "media" / m.id / name).exists()),
                        None,
                    ),
                    beats=media_beats(p, m),
                )
                for m in p.media.values()
            ],
            timeline=p.timeline,
            history=[CommitView(**c.model_dump(include=set(CommitView.model_fields))) for c in p.history],
            chat=p.chat,
            spent=round(p.spent, 4),
            speech=timeline_speech(p),
            tracks=[
                TrackView(id=t.id, media_id=t.media_id, prompt=t.prompt, url=f"/files/{p.id}/tracks/{t.id}.json")
                for t in p.tracks.values()
            ],
            references=[
                ReferenceView(id=r.id, name=r.name, url=f"/files/{p.id}/refs/{r.id}.jpg") for r in p.references.values()
            ],
            last_check=p.last_check,
            storyboard=p.storyboard,
            last_render_url=f"/files/{p.id}/{p.last_render}" if p.last_render else None,
            can_undo=bool(p.history),
            can_redo=bool(p.redo_stack),
            busy=project_lock(p.id).locked() if busy is None else busy,
        )


class CreateProject(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    aspect: Aspect = "16:9"
    fps: Literal[24, 30, 60] = 30


class RenameProject(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class ProjectSummary(BaseModel):
    """A dashboard card: enough to recognize a project without loading its timeline."""

    id: str
    name: str
    updated_at: str
    thumb_url: str | None
    duration: float
    aspect: Aspect
    fps: float
    clips: int
    media: int

    @classmethod
    def of(cls, p: Project, updated_at: str) -> "ProjectSummary":
        first = next((c.media_id for c in p.timeline.clips), None) or next(
            (m.id for m in p.media.values() if m.kind == "video"), None
        )
        return cls(
            id=p.id,
            name=p.name,
            updated_at=updated_at,
            thumb_url=f"/files/{p.id}/media/{first}/thumb.jpg" if first else None,
            duration=round(p.timeline.duration, 2),
            aspect=p.timeline.aspect,
            fps=p.timeline.fps,
            clips=len(p.timeline.clips),
            media=len(p.media),
        )


class GradeRequest(BaseModel):
    clip_ids: list[str] | None = None
    look: str | None = None
    intensity: float = Field(0.7, ge=0, le=1)
    auto: bool = True
    match: bool = True
    reference_id: str | None = Field(None, description="Match this reference image instead of applying a look")


class RenderRequest(BaseModel):
    final: bool = True


class RunRequest(BaseModel):
    instruction: str = Field(min_length=1, max_length=2000)
    reference_ids: list[str] = Field(default_factory=list, max_length=4)


class OpsRequest(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    ops: list[Op] = Field(min_length=1)


def load(project_id: str) -> Project:
    try:
        return store.get(project_id)
    except NotFound:
        raise HTTPException(404, f"Project {project_id} not found") from None


def ensure_idle(project_id: str) -> asyncio.Lock:
    """The project's lock for a user edit. Refuses while an agent run is active; otherwise the edit
    queues behind any other user request still holding the lock (slider drags send them back to back)."""
    if (run := _runs.get(project_id)) and not run[1].done():
        raise HTTPException(409, "The agent is editing this project; stop the run or wait for it to finish")
    return project_lock(project_id)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/projects")
def list_projects(request: Request) -> list[ProjectSummary]:
    return [ProjectSummary.of(p, at) for p, at in store.list(request.state.account)]


@app.post("/projects")
def create_project(body: CreateProject, request: Request) -> ProjectView:
    p = store.create(body.name, owner_id=request.state.account)
    p.timeline = p.timeline.model_copy(update={"aspect": body.aspect, "fps": body.fps})
    store.save(p)
    return ProjectView.of(p)


@app.patch("/projects/{project_id}")
async def rename_project(project_id: str, body: RenameProject) -> ProjectView:
    async with ensure_idle(project_id):
        p = load(project_id)
        p.name = body.name.strip()
        store.save(p)
        return ProjectView.of(p, busy=False)


@app.delete("/projects/{project_id}")
async def delete_project(project_id: str) -> dict[str, str]:
    async with ensure_idle(project_id):
        load(project_id)
        store.delete(project_id)
        shutil.rmtree(store.project_dir(project_id), ignore_errors=True)
    _locks.pop(project_id, None)
    return {"status": "deleted"}


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

        if media.kind == "video" and settings.max_file_seconds and media.duration > settings.max_file_seconds:
            shutil.rmtree(store.project_dir(p.id) / "media" / media_id, ignore_errors=True)
            raise HTTPException(
                400, f"This video is {media.duration:.0f}s; the public demo takes up to {settings.max_file_seconds:.0f}s per file"
            )
        # The 5-minute budget is for footage (it drives SAM and transcription cost); music is free to add.
        total = sum(m.duration for m in p.media.values() if m.kind == "video") + (media.duration if media.kind == "video" else 0)
        if total > MAX_TOTAL_SECONDS:
            shutil.rmtree(store.project_dir(p.id) / "media" / media_id, ignore_errors=True)
            raise HTTPException(400, f"Project footage would be {total:.0f}s; the limit is {MAX_TOTAL_SECONDS}s")
        p.media[media.id] = media
        store.save(p)
        return ProjectView.of(p, busy=False)


MAX_REFERENCE_BYTES = 15 * 1024 * 1024


@app.post("/projects/{project_id}/references")
async def upload_reference(project_id: str, file: UploadFile) -> ProjectView:
    """A still to grade toward: a film frame, a photo, a screenshot. Stored as a JPEG."""
    async with ensure_idle(project_id):
        p = load(project_id)
        data = await file.read(MAX_REFERENCE_BYTES + 1)
        if len(data) > MAX_REFERENCE_BYTES:
            raise HTTPException(400, "Reference images can be up to 15 MB")
        ref_id = new_id("ref")
        with tempfile.NamedTemporaryFile() as tmp:
            tmp.write(data)
            tmp.flush()
            try:
                reference.save(Path(tmp.name), store.project_dir(p.id) / "refs" / f"{ref_id}.jpg")
            except Exception:
                raise HTTPException(400, "That file isn't an image Auteur can read (use JPG, PNG or WebP)") from None
        name = Path(file.filename or "reference").stem[:60] or "reference"
        p.references[ref_id] = ReferenceImage(id=ref_id, name=name)
        store.save(p)
        return ProjectView.of(p, busy=False)


@app.delete("/projects/{project_id}/references/{ref_id}")
async def delete_reference(project_id: str, ref_id: str) -> ProjectView:
    async with ensure_idle(project_id):
        p = load(project_id)
        if p.references.pop(ref_id, None) is None:
            raise HTTPException(404, f"Reference {ref_id} not found")
        (store.project_dir(p.id) / "refs" / f"{ref_id}.jpg").unlink(missing_ok=True)
        store.save(p)
        return ProjectView.of(p, busy=False)


@app.post("/projects/{project_id}/ops")
async def apply_ops(project_id: str, body: OpsRequest) -> ProjectView:
    async with ensure_idle(project_id):
        p = load(project_id)
        try:
            p.commit("user", body.label, body.ops)
        except OpError as e:
            raise HTTPException(400, str(e)) from None
        store.save(p)
        return ProjectView.of(p, busy=False)


@app.post("/projects/{project_id}/undo")
async def undo(project_id: str) -> ProjectView:
    async with ensure_idle(project_id):
        p = load(project_id)
        p.undo()
        store.save(p)
        return ProjectView.of(p, busy=False)


@app.post("/projects/{project_id}/redo")
async def redo(project_id: str) -> ProjectView:
    async with ensure_idle(project_id):
        p = load(project_id)
        p.redo()
        store.save(p)
        return ProjectView.of(p, busy=False)


@app.post("/projects/{project_id}/runs")
async def start_run(project_id: str, body: RunRequest, request: Request) -> dict[str, str]:
    load(project_id)
    lock = ensure_idle(project_id)
    if (run := _runs.get(project_id)) and not run[1].done():
        raise HTTPException(409, "The agent is already running")
    p = load(project_id)
    unknown = [r for r in body.reference_ids if r not in p.references]
    if unknown:
        raise HTTPException(400, f"Unknown reference images {unknown}")
    check_run_quota(request)
    run_id = new_id("run")
    task = asyncio.create_task(run_agent(store, project_id, run_id, body.instruction, lock, body.reference_ids))
    _runs[project_id] = (run_id, task)
    return {"run_id": run_id}


class StoryboardSceneEdit(BaseModel):
    id: str = Field("", description="Existing scene id; empty for a new scene")
    title: str = Field(min_length=1, max_length=80)
    duration: float = Field(ge=1, le=20)
    brief: str = Field(min_length=1, max_length=2000)
    images: list[str] = Field(default_factory=list, max_length=4)


class StoryboardEdit(BaseModel):
    style: str = Field(max_length=3000)
    scenes: list[StoryboardSceneEdit] = Field(min_length=1, max_length=40)


@app.put("/projects/{project_id}/storyboard")
async def edit_storyboard(project_id: str, body: StoryboardEdit) -> ProjectView:
    """The storyboard panel's edits: scenes whose text or timing changed need a rebuild; order and
    removals apply to the timeline right away."""
    async with ensure_idle(project_id):
        p = load(project_id)
        if p.storyboard is None:
            raise HTTPException(400, "This project has no storyboard yet; ask the agent for a video made in code")
        total = sum(s.duration for s in body.scenes)
        if total > motion.MAX_SECONDS:
            raise HTTPException(400, f"The scenes add up to {total:g}s; the limit is {motion.MAX_SECONDS}s")
        p.storyboard = motion.merge_storyboard(
            p.storyboard, p.storyboard.brief, body.model_dump(), set(p.references),
        )
        ops = motion.place_scenes(p.timeline, p.media, p.storyboard)
        if ops:
            try:
                p.commit("user", "Storyboard order", ops)
            except OpError as e:
                raise HTTPException(400, str(e)) from None
        store.save(p)
        return ProjectView.of(p, busy=False)


class BuildScenesRequest(BaseModel):
    scene_ids: list[str] | None = Field(None, max_length=40)
    notes: list[dict[str, str]] = Field(default_factory=list, max_length=40)


@app.post("/projects/{project_id}/scenes/build")
async def build_scenes_now(project_id: str, body: BuildScenesRequest, request: Request) -> dict[str, str]:
    """The storyboard panel's Build buttons: runs `build_scenes` directly, as a run the editor follows."""
    p = load(project_id)
    lock = ensure_idle(project_id)
    if (run := _runs.get(project_id)) and not run[1].done():
        raise HTTPException(409, "The agent is already running")
    if p.storyboard is None:
        raise HTTPException(400, "This project has no storyboard yet")
    check_run_quota(request)
    names = {s.id: f"{i + 1}" for i, s in enumerate(p.storyboard.scenes)}
    if body.scene_ids and len(body.scene_ids) == 1 and body.scene_ids[0] in names:
        label = f"Build scene {names[body.scene_ids[0]]}"
    else:
        label = "Build scenes"
    run_id = new_id("run")
    args = {"scene_ids": body.scene_ids, "notes": body.notes}
    task = asyncio.create_task(run_tool(store, project_id, run_id, label, "build_scenes", args, lock))
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
    """Undo every edit of an agent instruction ("undo my last instruction")."""
    async with ensure_idle(project_id):
        p = load(project_id)
        if p.undo_run(run_id) == 0:
            raise HTTPException(400, "That instruction has no edits at the top of the history to undo")
        store.save(p)
        return ProjectView.of(p, busy=False)


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


@app.get("/looks")
def looks() -> list[dict[str, str]]:
    return [{"id": k, "label": v} for k, v in colorist.LOOK_LABELS.items()]


@app.post("/projects/{project_id}/grade")
async def grade_project(project_id: str, body: GradeRequest) -> ProjectView:
    """The inspector's look buttons: the same correction, matching and looks as the agent's `grade` tool."""
    if body.look is not None and body.look not in colorist.LOOKS:
        raise HTTPException(400, f"Unknown look {body.look!r}")
    async with ensure_idle(project_id):
        p = load(project_id)
        clips = [c for c in p.timeline.clips if body.clip_ids is None or c.id in body.clip_ids]
        if not clips:
            raise HTTPException(400, "No clips to grade")
        if body.reference_id is not None:
            if body.reference_id not in p.references:
                raise HTTPException(400, f"Unknown reference image {body.reference_id!r}")
            ref = reference.load(store.project_dir(p.id) / "refs" / f"{body.reference_id}.jpg")
            results = await asyncio.to_thread(
                colorist.match_reference, p.media, clips, ref, body.intensity, body.auto, {},
            )
            label = f"Match {p.references[body.reference_id].name}"
        else:
            results = await asyncio.to_thread(
                colorist.grade_clips, p.media, clips, body.look, body.intensity, body.auto, body.match, None, {},
            )
            label = colorist.LOOK_LABELS.get(body.look or "", "Correction")
        try:
            p.commit("user", f"Color: {label}", [SetGrade(clip_ids=[cid], grade=g) for cid, g, _, _ in results])
        except OpError as e:
            raise HTTPException(400, str(e)) from None
        store.save(p)
        return ProjectView.of(p, busy=False)


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
        return ProjectView.of(p, busy=False)
