import asyncio
import json
import re
import shutil
from datetime import date
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, quote

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.types import ASGIApp, Receive, Scope, Send
from sse_starlette.sse import EventSourceResponse

from auteur import colorist, costs, derived, exporter, fetch, freeze, imagegen, masks, motion, reference, transcript_edit, translate, tts
from auteur.agent.tools import filler_ops
from auteur.transcript import transcribe
from auteur.agent.loop import run_agent, run_tool
from auteur.config import settings
from auteur.events import bus
from auteur.media import MediaError, ingest, make_waveform, media_dir
from auteur.render import RenderError, render
from auteur.auth import ClerkAuth
from auteur.store import NotFound, Store
from auteur.timeline import Media, Op, OpError, Project, Timeline
from auteur.timeline.history import ChatMessage, CheckResult, LutInfo, ReferenceImage, Storyboard
from auteur.tracking import load_track
from auteur.timeline.models import Aspect
from auteur.subtitles import wrap
from auteur.timeline.models import Backdrop, BgRemove
from auteur.timeline.ops import AddAudio, SetBgRemove, SetGrade, SetVolume, UpdateText, new_id

# Everything else needs a signed-in account. Media files stay public: their project ids are unguessable
# and <video> elements cannot attach credentials cross-origin anyway.
PUBLIC_PATHS = ("/health", "/files/", "/looks", "/voices", "/docs", "/openapi.json")

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
class ProjectFiles(StaticFiles):
    """Project media and renders. `?download=<name>` sends a file as an attachment under that name, so the
    editor's download buttons save it instead of opening the video (works across origins, unlike <a download>)."""

    def file_response(self, full_path, stat_result, scope, status_code=200):  # type: ignore[no-untyped-def]
        response = super().file_response(full_path, stat_result, scope, status_code)
        name = parse_qs(scope.get("query_string", b"").decode()).get("download", [""])[0]
        if name:
            # Letters, digits, spaces and a little punctuation; anything else (slashes, quotes, control
            # characters) becomes "_". The suffix comes from the real file.
            safe = re.sub(r"[^\w .()-]+", "_", name).strip(" .")[:120] or "auteur"
            response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(safe + Path(full_path).suffix)}"
        return response


app.mount("/files", ProjectFiles(directory=settings.data_dir / "projects"), name="files")

# One lock per project serializes edits; an agent run holds it for the whole run.
_locks: dict[str, asyncio.Lock] = {}
_runs: dict[str, tuple[str, asyncio.Task]] = {}
_visitor_runs: dict[tuple[str, date], int] = {}
_exports: dict[str, exporter.ExportJob] = {}  # latest export per project
_background: set[asyncio.Task] = set()  # keeps fire-and-forget tasks referenced until they finish


def remaining_budget(request: Request) -> float | None:
    """USD a run may still spend under the configured caps, or None when no cap is set. Expensive tools
    (scene builds) check their estimate against it, since the caps themselves are only checked when a run starts."""
    left = []
    if settings.spend_cap_usd:
        left.append(settings.spend_cap_usd - store.total_spent())
    if settings.user_spend_cap_usd:
        left.append(settings.user_spend_cap_usd - store.spent_by(request.state.account))
    return max(0.0, min(left)) if left else None


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
    waveform_url: str | None = Field(None, description="Picture of the sound, ~40 px per second")
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
    luts: list[LutInfo]
    clip_previews: dict[str, str | None] = Field(
        description="Clips the editor plays from a prepared variant (reversed, or with a LUT): its url, or null while it is being made"
    )
    last_check: CheckResult | None
    storyboard: Storyboard | None
    export: exporter.ExportView | None
    max_export_height: int | None = Field(description="Largest export this server makes (short side); None = no limit")
    max_footage_seconds: float = Field(description="Footage allowed per project, all videos together")
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
                    waveform_url=(
                        f"{base}/{m.id}/filmstrip.png" if m.kind == "audio"
                        else f"{base}/{m.id}/waveform.png" if (store.project_dir(p.id) / "media" / m.id / "waveform.png").exists()
                        else None
                    ),
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
            luts=list(p.luts.values()),
            clip_previews=clip_previews(p),
            export=_exports[p.id].view() if p.id in _exports else None,
            max_export_height=settings.max_export_height or None,
            max_footage_seconds=settings.max_footage_seconds,
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
async def get_project(project_id: str) -> ProjectView:
    p = load(project_id)
    backfill_waveforms(p)
    return ProjectView.of(p)


_waveforms_pending: set[str] = set()


def backfill_waveforms(p: Project) -> None:
    """Footage uploaded before clip waveforms existed gets them in the background; the editor hears
    about it as a "project" event."""
    missing = [
        m for m in p.media.values()
        if m.kind == "video" and m.has_audio and m.id not in _waveforms_pending
        and not (store.project_dir(p.id) / "media" / m.id / "waveform.png").exists()
    ]
    if not missing:
        return
    _waveforms_pending.update(m.id for m in missing)

    async def run() -> None:
        try:
            for m in missing:
                out = store.project_dir(p.id) / "media" / m.id / "waveform.png"
                await asyncio.to_thread(make_waveform, Path(m.path), out, m.duration)
        except MediaError:
            pass
        finally:
            _waveforms_pending.difference_update(m.id for m in missing)
        bus.publish(p.id, {"type": "project"}, replay=False)

    task = asyncio.create_task(run())
    _background.add(task)
    task.add_done_callback(_background.discard)


async def add_media(p: Project, upload: Path, name: str) -> ProjectView:
    """Ingest a file into the project (caller holds the project lock); `upload` is moved or removed.
    Other open editors (another tab, or the editor while a phone uploads) hear about it as a "project" event."""
    media_id = new_id("media")
    try:
        media = await asyncio.to_thread(ingest, store.project_dir(p.id), media_id, name, upload)
    except MediaError as e:
        shutil.rmtree(store.project_dir(p.id) / "media" / media_id, ignore_errors=True)
        raise HTTPException(400, f"Could not read that file: {e}") from None
    finally:
        upload.unlink(missing_ok=True)

    if media.kind == "video" and not media.image and settings.max_file_seconds and media.duration > settings.max_file_seconds:
        shutil.rmtree(store.project_dir(p.id) / "media" / media_id, ignore_errors=True)
        raise HTTPException(
            400, f"This video is {media.duration:.0f}s; the public demo takes up to {settings.max_file_seconds:.0f}s per file"
        )

    # The footage budget (MAX_FOOTAGE_SECONDS) drives SAM and transcription cost; music, pictures and
    # scenes made in code are free to add.
    def counts(m: Media) -> bool:
        return m.kind == "video" and not m.scene_id and not m.image

    footage = sum(m.duration for m in p.media.values() if counts(m))
    total = footage + (media.duration if counts(media) else 0)
    if total > settings.max_footage_seconds:
        shutil.rmtree(store.project_dir(p.id) / "media" / media_id, ignore_errors=True)
        raise HTTPException(400, f"Project footage would be {total:.0f}s; the limit is {settings.max_footage_seconds:.0f}s")
    p.media[media.id] = media
    store.save(p)
    bus.publish(p.id, {"type": "project"}, replay=False)
    return ProjectView.of(p, busy=False)


@app.post("/projects/{project_id}/media")
async def upload_media(project_id: str, file: UploadFile) -> ProjectView:
    async with ensure_idle(project_id):
        p = load(project_id)
        suffix = Path(file.filename or "upload.mp4").suffix
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=settings.data_dir) as tmp:
            shutil.copyfileobj(file.file, tmp)
        return await add_media(p, Path(tmp.name), file.filename or "upload")


class GenerateImage(BaseModel):
    prompt: str = Field(min_length=3, max_length=2000)


@app.post("/projects/{project_id}/media/generate")
async def generate_image(project_id: str, body: GenerateImage, request: Request) -> ProjectView:
    """A picture from a prompt with Muse Image, in the project's aspect ratio, into the media bin."""
    check_run_quota(request)
    load(project_id)
    media_id = new_id("media")
    # Generated before taking the project lock (it takes ~10s); the media is added under the lock.
    try:
        p = load(project_id)
        media = await asyncio.to_thread(imagegen.generate, store.project_dir(project_id), media_id, body.prompt, p.timeline.aspect)
    except imagegen.ImageGenError as e:
        shutil.rmtree(store.project_dir(project_id) / "media" / media_id, ignore_errors=True)
        raise HTTPException(400, str(e)) from None
    async with ensure_idle(project_id):
        p = load(project_id)
        p.media[media.id] = media
        p.spent += imagegen.PRICE
        store.save(p)
        bus.publish(p.id, {"type": "project"}, replay=False)
        return ProjectView.of(p, busy=False)

class ImportLink(BaseModel):
    url: str = Field(min_length=8, max_length=2000)


@app.post("/projects/{project_id}/media/link")
async def import_media_link(project_id: str, body: ImportLink) -> ProjectView:
    """Import a direct link to a video, song or picture (e.g. a Pexels or Pixabay download link)."""
    load(project_id)
    with tempfile.TemporaryDirectory(dir=settings.data_dir) as tmp:
        # Downloaded before taking the project lock: a slow server shouldn't block editing.
        try:
            path = await asyncio.to_thread(fetch.download, body.url.strip(), Path(tmp))
        except fetch.FetchError as e:
            raise HTTPException(400, str(e)) from None
        async with ensure_idle(project_id):
            return await add_media(load(project_id), path, path.name)


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


_variants_pending: set[tuple[str, str]] = set()


def _prepared(p: Project, media_id: str, name: str, make) -> str | None:
    """The url of a derived preview file, or None while it is made in the background (announced with a
    "project" event when ready). `make` builds it, blocking."""
    path = store.project_dir(p.id) / "media" / media_id / name
    if path.exists():
        return f"/files/{p.id}/media/{media_id}/{name}"
    key = (media_id, name)
    if key in _variants_pending:
        return None
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return None
    _variants_pending.add(key)

    async def run() -> None:
        try:
            await asyncio.to_thread(make)
        except (derived.DerivedError, OSError):
            pass  # the editor keeps the plain preview; the export reports real problems
        finally:
            _variants_pending.discard(key)
        bus.publish(p.id, {"type": "project"}, replay=False)

    task = loop.create_task(run())
    _background.add(task)
    task.add_done_callback(_background.discard)
    return None


def clip_previews(p: Project) -> dict[str, str | None]:
    """Prepared previews for reversed, LUT, cleaned-sound and background-removed clips, keyed B-roll and
    cleaned music-track items (by item id)."""
    out: dict[str, str | None] = {}
    luts = store.project_dir(p.id) / "luts"
    for c in p.timeline.clips:
        name = derived.preview_name(c)
        if name and c.media_id in p.media:
            m, d = p.media[c.media_id], store.project_dir(p.id) / "media" / c.media_id
            out[c.id] = _prepared(p, c.media_id, name, lambda m=m, d=d, c=c: derived.make_variant(d, m, c, luts))
    for o in p.timeline.overlays:
        name = derived.overlay_variant_name(o)
        if name and o.media_id in p.media:
            d = store.project_dir(p.id) / "media" / o.media_id
            out[o.id] = _prepared(p, o.media_id, name, lambda d=d, o=o: derived.make_overlay_variant(d, o))
    for a in p.timeline.audio:
        name = derived.audio_variant_name(a)
        if name and a.media_id in p.media:
            d = store.project_dir(p.id) / "media" / a.media_id
            preview = d / ("preview.m4a" if p.media[a.media_id].kind == "audio" else "preview.mp4")
            out[a.id] = _prepared(p, a.media_id, name, lambda d=d, preview=preview, a=a: derived.make_audio_variant(d, preview, a))
    return out


MAX_LUT_BYTES = 8 * 1024 * 1024


@app.post("/projects/{project_id}/luts")
async def upload_lut(project_id: str, file: UploadFile) -> ProjectView:
    """A 3D LUT (.cube) for the project; clips use it with set_lut."""
    data = await file.read(MAX_LUT_BYTES + 1)
    if len(data) > MAX_LUT_BYTES:
        raise HTTPException(400, "LUT files go up to 8 MB")
    try:
        size, _ = derived.parse_cube(data.decode("utf-8", errors="replace"))
    except derived.DerivedError as e:
        raise HTTPException(400, f"Not a usable .cube LUT: {e}") from None
    async with ensure_idle(project_id):
        p = load(project_id)
        lut_id = new_id("lut")
        d = store.project_dir(p.id) / "luts"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{lut_id}.cube").write_bytes(data)
        name = Path(file.filename or "LUT").stem[:60] or "LUT"
        p.luts[lut_id] = LutInfo(id=lut_id, name=name, size=size)
        store.save(p)
        return ProjectView.of(p, busy=False)


@app.delete("/projects/{project_id}/luts/{lut_id}")
async def delete_lut(project_id: str, lut_id: str) -> ProjectView:
    async with ensure_idle(project_id):
        p = load(project_id)
        if lut_id not in p.luts:
            raise HTTPException(404, f"LUT {lut_id} not found")
        if any(c.lut and c.lut.lut_id == lut_id for c in p.timeline.clips):
            raise HTTPException(400, "Clips still use this LUT; remove it from them first")
        p.luts.pop(lut_id)
        (store.project_dir(p.id) / "luts" / f"{lut_id}.cube").unlink(missing_ok=True)
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
    task = asyncio.create_task(
        run_agent(store, project_id, run_id, body.instruction, lock, body.reference_ids, budget=remaining_budget(request))
    )
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
    task = asyncio.create_task(
        run_tool(store, project_id, run_id, label, "build_scenes", args, lock, budget=remaining_budget(request))
    )
    _runs[project_id] = (run_id, task)
    return {"run_id": run_id}


class ExportRequest(BaseModel):
    format: exporter.Format = "mp4"
    resolution: Literal[360, 480, 720, 1080, 1440, 2160] = 1080
    quality: exporter.Quality = "standard"
    fps: Literal[24, 25, 30, 50, 60] | None = Field(None, description="None = the project's frame rate")
    mbps: float | None = Field(None, ge=0.5, le=100, description="Target video bitrate in Mbit/s; None = the quality preset")


@app.post("/projects/{project_id}/exports")
async def start_export(project_id: str, body: ExportRequest) -> exporter.ExportView:
    """The Export dialog: renders a snapshot of the timeline in the background (editing stays open)."""
    p = load(project_id)
    if not p.timeline.clips:
        raise HTTPException(400, "The timeline is empty")
    if (job := _exports.get(project_id)) and job.status == "running":
        raise HTTPException(409, "An export is already running for this project")
    if settings.max_export_height and body.resolution > settings.max_export_height and body.format != "mp3":
        raise HTTPException(400, f"This server exports up to {settings.max_export_height}p")
    if body.format == "gif":
        if body.resolution > exporter.GIF_MAX_HEIGHT:
            raise HTTPException(400, f"GIFs go up to {exporter.GIF_MAX_HEIGHT}p; they get huge above that")
        if p.timeline.duration > exporter.GIF_MAX_SECONDS:
            raise HTTPException(400, f"GIFs go up to {exporter.GIF_MAX_SECONDS}s; this video is {p.timeline.duration:.0f}s")
    project_dir = store.project_dir(p.id)
    tracks = {e.track_id: load_track(project_dir, e.track_id) for c in p.timeline.clips for e in c.effects}
    job = exporter.ExportJob(
        id=new_id("export"), project_id=p.id, format=body.format, resolution=body.resolution, quality=body.quality,
        fps=float(body.fps or p.timeline.fps), mbps=body.mbps if body.format == "mp4" else None,
    )
    _exports[p.id] = job

    def publish(view: exporter.ExportView) -> None:
        bus.publish(p.id, {"type": "export", "export": view.model_dump()}, replay=False)

    def on_done(done: exporter.ExportJob) -> None:
        # "Latest render" follows video exports, unless an agent run holds the project (it saves its own copy).
        if done.format == "mp4" and not project_lock(p.id).locked():
            fresh = load(p.id)
            fresh.last_render = done.file
            store.save(fresh)

    task = asyncio.create_task(
        exporter.start(job, p.timeline.model_copy(deep=True), dict(p.media), tracks, project_dir, publish, on_done)
    )
    _background.add(task)
    task.add_done_callback(_background.discard)
    return job.view()


@app.post("/projects/{project_id}/exports/{export_id}/cancel")
async def cancel_export(project_id: str, export_id: str) -> dict[str, bool]:
    job = _exports.get(project_id)
    if job is None or job.id != export_id or job.status != "running":
        return {"cancelled": False}
    job.cancel.set()
    return {"cancelled": True}


class FreezeRequest(BaseModel):
    at: float = Field(ge=0, description="Timeline time of the frame to hold")
    duration: float = Field(2, ge=0.2, le=30)


@app.post("/projects/{project_id}/clips/{clip_id}/freeze")
async def freeze_frame(project_id: str, clip_id: str, body: FreezeRequest) -> ProjectView:
    """Hold the frame at the playhead: the clip splits there and a still of that frame goes in between."""
    async with ensure_idle(project_id):
        p = load(project_id)
        try:
            ops = await asyncio.to_thread(freeze.freeze, p, store.project_dir(p.id), clip_id, body.at, body.duration)
            p.commit("user", f"Freeze frame {body.duration:g}s", ops)
        except (freeze.FreezeError, OpError) as e:
            raise HTTPException(400, str(e)) from None
        store.save(p)
        return ProjectView.of(p, busy=False)

@app.get("/projects/{project_id}/transcript")
def get_transcript(project_id: str) -> transcript_edit.TranscriptView:
    p = load(project_id)
    return transcript_edit.view(p, store.project_dir(p.id))


@app.post("/projects/{project_id}/transcript/run")
async def run_transcription(project_id: str, request: Request) -> transcript_edit.TranscriptView:
    """Transcribe the timeline's footage with Voice Transcribe (once per media; cached for the agent too)."""
    check_run_quota(request)
    async with ensure_idle(project_id):
        p = load(project_id)
        todo = transcript_edit.view(p, store.project_dir(p.id)).missing
        for mid in todo:
            m = p.media[mid]
            cache = media_dir(store.project_dir(p.id), mid) / "transcript.json"
            try:
                await asyncio.to_thread(transcribe, Path(m.path), cache)
            except Exception as e:  # the API or ffmpeg; nothing half-written is kept
                raise HTTPException(502, f"Transcription failed for {m.name}: {e}") from None
            p.spent += costs.transcribe(m.duration)
        store.save(p)
        return transcript_edit.view(p, store.project_dir(p.id))


class WordCut(BaseModel):
    clip_id: str
    src_start: float = Field(ge=0)
    src_end: float = Field(gt=0)


class TranscriptCut(BaseModel):
    cuts: list[WordCut] = Field(min_length=1, max_length=2000)
    label: str = Field("Cut words", max_length=80)


@app.post("/projects/{project_id}/transcript/cut")
async def cut_words(project_id: str, body: TranscriptCut) -> ProjectView:
    """Delete words from the transcript: each run of deleted words is cut out of its clip."""
    async with ensure_idle(project_id):
        p = load(project_id)
        by_clip: dict[str, list[tuple[float, float]]] = {}
        for c in body.cuts:
            by_clip.setdefault(c.clip_id, []).append((c.src_start, c.src_end))
        scratch, ops = p.timeline, []
        for clip_id, ranges in by_clip.items():
            if not any(c.id == clip_id for c in scratch.clips):
                raise HTTPException(400, f"Clip {clip_id} not found")
            more, scratch, _ = filler_ops(scratch, clip_id, transcript_edit.merge(ranges), p.media)
            ops += more
        if not ops:
            raise HTTPException(400, "Nothing left to cut there")
        try:
            p.commit("user", body.label, ops)
        except OpError as e:
            raise HTTPException(400, str(e)) from None
        store.save(p)
        return ProjectView.of(p, busy=False)

class TranslateRequest(BaseModel):
    language: str = Field(min_length=2, max_length=40, description="e.g. English, Indonesian, Spanish")
    subtitles_only: bool = True


@app.post("/projects/{project_id}/texts/translate")
async def translate_texts(project_id: str, body: TranslateRequest, request: Request) -> ProjectView:
    """Translate subtitles (or every text) with Muse Spark; one undoable edit."""
    check_run_quota(request)
    async with ensure_idle(project_id):
        p = load(project_id)
        try:
            ops, usd = await translate.translate_ops(p, body.language.strip(), body.subtitles_only)
        except translate.TranslateError as e:
            raise HTTPException(400, str(e)) from None
        p.spent += usd
        if ops:
            p.commit("user", f"Translate to {body.language.strip()}", ops)
        store.save(p)
        return ProjectView.of(p, busy=False)

class VoiceoverRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    language: str = "English"
    voice: Literal["natural", "deeper", "brighter"] = "natural"
    speed: float = Field(1.0, ge=0.5, le=2)
    at: float | None = Field(None, ge=0, description="Put it on the music track at this time; None = media bin only")


@app.post("/projects/{project_id}/voiceover")
async def make_voiceover(project_id: str, body: VoiceoverRequest) -> ProjectView:
    """Spoken text with Meta MMS-TTS, as audio media (and on the timeline at `at`)."""
    load(project_id)
    with tempfile.TemporaryDirectory(dir=settings.data_dir) as tmp:
        try:
            wav = await asyncio.to_thread(tts.voiceover, body.text, body.language, body.voice, body.speed, Path(tmp) / "voice.wav")
        except tts.TTSError as e:
            raise HTTPException(400, str(e)) from None
        async with ensure_idle(project_id):
            p = load(project_id)
            media_id = new_id("media")
            try:
                media = await asyncio.to_thread(
                    ingest, store.project_dir(p.id), media_id, f"Voice: {' '.join(body.text.split())[:40]}", wav
                )
            except MediaError as e:
                raise HTTPException(400, str(e)) from None
            p.media[media.id] = media
            if body.at is not None:
                p.commit("user", "Voice-over", [AddAudio(media_id=media.id, start=body.at, volume=1, fade_in=0.05, fade_out=0.2, duck=False)])
            store.save(p)
            return ProjectView.of(p, busy=False)


class DubRequest(BaseModel):
    language: str
    voice: Literal["natural", "deeper", "brighter"] = "natural"
    original_volume: float = Field(0.15, ge=0, le=1, description="The original sound under the dub")


@app.post("/projects/{project_id}/dub")
async def dub(project_id: str, body: DubRequest, request: Request) -> ProjectView:
    """Translate the subtitles (Muse Spark), speak them (MMS-TTS) on one track, turn the original down."""
    check_run_quota(request)
    async with ensure_idle(project_id):
        p = load(project_id)
        subs = sorted((t for t in p.timeline.texts if t.style == "subtitle"), key=lambda t: t.start)
        if not subs:
            raise HTTPException(400, "Dubbing speaks the subtitles; add subtitles first")
        if body.language not in tts.LANGUAGES:
            raise HTTPException(400, f"No voice for {body.language}; available: {', '.join(tts.LANGUAGES)}")
        try:
            lines, usd = await translate.translate_lines([" ".join(t.text.split()) for t in subs], body.language)
        except translate.TranslateError as e:
            raise HTTPException(400, str(e)) from None
        p.spent += usd
        with tempfile.TemporaryDirectory(dir=settings.data_dir) as tmp:
            try:
                wav = await asyncio.to_thread(
                    tts.dub_track, [(t.start, t.end, line) for t, line in zip(subs, lines)], body.language, body.voice,
                    p.timeline.duration, Path(tmp) / "dub.wav",
                )
            except tts.TTSError as e:
                raise HTTPException(400, str(e)) from None
            media_id = new_id("media")
            try:
                media = await asyncio.to_thread(ingest, store.project_dir(p.id), media_id, f"Dub ({body.language}).wav", wav)
            except MediaError as e:
                raise HTTPException(400, str(e)) from None
        p.media[media.id] = media
        out_w, out_h = p.timeline.size
        ops: list = [AddAudio(media_id=media.id, start=0, volume=1, fade_in=0, fade_out=0.3, duck=False)]
        ops += [SetVolume(clip_id=c.id, volume=round(c.volume * body.original_volume, 3)) for c in p.timeline.clips if c.has_sound]
        for t, line in zip(subs, lines):
            ops.append(UpdateText(text_id=t.id, text="\n".join(" ".join(ln) for ln in wrap(line.split(), t.look, out_w, out_h))))
        p.commit("user", f"Dub into {body.language}", ops)
        store.save(p)
        return ProjectView.of(p, busy=False)


@app.get("/voices")
def voices() -> dict[str, list[str]]:
    return {"languages": list(tts.LANGUAGES), "voices": list(tts.VOICES)}

class RemoveBackground(BaseModel):
    prompt: str = Field("person", min_length=1, max_length=60)
    keep: Literal["main", "all"] = "main"
    backdrop: Backdrop = Field(default_factory=Backdrop)


@app.post("/projects/{project_id}/clips/{clip_id}/remove-background")
async def remove_background(project_id: str, clip_id: str, body: RemoveBackground, request: Request) -> ProjectView:
    """Mask the subject with SAM 3.1 (once per media and prompt) and replace the rest with a backdrop."""
    check_run_quota(request)
    async with ensure_idle(project_id):
        p = load(project_id)
        clip = next((c for c in p.timeline.clips if c.id == clip_id), None)
        if clip is None:
            raise HTTPException(404, f"Clip {clip_id} not found")
        try:
            _, frames = await masks.make_mask(store.project_dir(p.id), clip.media_id, body.prompt, body.keep)
        except masks.MaskError as e:
            raise HTTPException(400, str(e)) from None
        except Exception as e:  # the SAM API
            raise HTTPException(502, f"SAM 3.1 failed: {e}") from None
        p.spent += costs.sam(frames)
        try:
            p.commit("user", "Remove background", [SetBgRemove(clip_id=clip_id, bg_remove=BgRemove(**body.model_dump()))])
        except OpError as e:
            raise HTTPException(400, str(e)) from None
        store.save(p)
        return ProjectView.of(p, busy=False)

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
                if event["type"] in ("timeline", "track", "run_finished", "project"):
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
