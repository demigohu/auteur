"""Videos made in code: Muse Wonder writes a storyboard, then each scene as a Remotion component that
motion/render.mjs renders to MP4.

A rendered scene becomes ordinary (silent) media, so the timeline, preview, grading, music, subtitles
and export treat it like footage. Each scene is built in a loop: write, compile, render, look at
frames of the render, and fix what is wrong, a bounded number of times.

Scene code is untrusted (the model read user text), so it never runs in the editor's browser: only
the renderer's headless Chromium runs it, behind the checks described in motion/validate.mjs.
"""

import asyncio
import base64
import json
import os
import re
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from openai import APITimeoutError, AsyncOpenAI

from auteur import costs
from auteur.config import settings
from auteur.timeline.history import Storyboard, StoryScene
from auteur.timeline.models import Media, Timeline
from auteur.timeline.ops import AddClip, Delete, Move, Op, SetTransition, apply, new_id

WONDER = "muse-wonder-1.0"
MOTION_DIR = Path(os.getenv("AUTEUR_MOTION_DIR", Path(__file__).resolve().parents[3] / "motion"))
MAX_SECONDS = 180
MIN_SECONDS = 5
COST_PER_SCENE = 0.25  # USD, measured: a write, a look at its frames, sometimes a fix
CODE_TRIES = 3  # writes + fixes of one scene's code before it is marked failed
PARALLEL_WRITES = 4
PARALLEL_RENDERS = int(os.getenv("MOTION_PARALLEL_RENDERS", "2"))

_writes = asyncio.Semaphore(PARALLEL_WRITES)
_renders = asyncio.Semaphore(PARALLEL_RENDERS)


class SceneError(Exception):
    """Compile or render failure, worded for the model to fix."""


FONTS = """fonts (import { fonts } from "@auteur/kit"; use as fontFamily):
  fonts.anton: tall condensed display caps (400)
  fonts.bebas: condensed caps (400)
  fonts.inter: neutral sans (400, 500, 700, 900)
  fonts.grotesk: Space Grotesk, techy sans (400, 700)
  fonts.montserrat: geometric sans (500, 800, 900)
  fonts.playfair: high-contrast serif (400, 700, italic 400)
  fonts.dmSerif: DM Serif Display (400, italic 400)
  fonts.instrument: Instrument Serif, editorial (400, italic 400)
  fonts.mono: JetBrains Mono (400, 700)
  fonts.hand: Caveat, handwriting (400, 700)"""

STORYBOARD_SYSTEM = f"""You are the creative director of short videos made entirely in code with Remotion: \
launch films, explainers, social promos, title sequences, pitch videos. You write the storyboard; a \
motion designer builds each scene from your brief alone, without asking questions.

Rules:
- The total length must be within 10% of the requested duration (max {MAX_SECONDS}s). Scenes are 2-12 \
seconds; one idea per scene.
- `style` is one paragraph every scene follows: background and accent colors as hex codes, which fonts \
(only from the list below) for what, type scale, motion language (snappy, springy, smooth...), and one or \
two recurring elements that tie the scenes together. Give sizes as fractions of the frame, never in pixels \
(the same storyboard may be built at 16:9 or 9:16): a scene's hero line is big, at least 10% of the frame \
height and usually spanning half the width or more; supporting text at least 4% of the frame height. \
Negative space is fine, but a title card is not a small line in an empty frame. Make it distinctive and fitting for the subject; \
avoid the generic look (purple gradients, glassy cards, centered everything) unless asked.
- Each scene's `brief`: the EXACT on-screen text in double quotes, the layout, what moves and how, and \
how it enters and leaves. Keep on-screen text short (at most about 12 words per scene) so it can be read \
in time. Never invent facts, numbers, customers or quotes the user didn't give; leave them out.
- Reference images: if the user attached images (screenshots, logos, photos) and a scene should show \
one, put its id in that scene's `images` and say in the brief how it is shown (device frame, card, full \
bleed, Ken Burns...).
- Vertical 9:16 and portrait 4:5: big type, center-weighted layout, one short line at a time.
- Revising an existing storyboard: return the full storyboard; keep the `id`, title, brief and duration \
of every scene the instruction doesn't touch, exactly. New scenes get an empty id.
- Write in the language of the on-screen text the user wants (default: the user's language).

{FONTS}"""

STORYBOARD_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["style", "scenes"],
    "properties": {
        "style": {"type": "string"},
        "scenes": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "title", "duration", "brief", "images"],
                "properties": {
                    "id": {"type": "string"},
                    "title": {"type": "string"},
                    "duration": {"type": "number"},
                    "brief": {"type": "string"},
                    "images": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
    },
}

SCENE_SYSTEM = f"""You are a senior motion designer who builds video scenes as Remotion components \
(React + TypeScript). You write ONE scene of a larger video from its brief.

The component:
- `export const Scene: React.FC<{{ width: number; height: number; fps: number; durationInFrames: number; \
images: Record<string, string> }}>`. Function components only.
- Imports allowed, nothing else: "react", "remotion", "@remotion/shapes", "@remotion/paths", \
"@remotion/noise", "@remotion/transitions" (and its "/fade", "/slide", "/wipe", "/flip", "/iris", \
"/clock-wipe"), "@auteur/kit".
- {FONTS}
- No network and no browser APIs: never use fetch, window, document, globalThis, storage, eval, \
Function, `.constructor`, remote URLs, <script>/<iframe>, dangerouslySetInnerHTML or setInterval. Show \
images only from `images[id]` with remotion's <Img src={{images["ref_..."]}} />.
- Deterministic: animate only from useCurrentFrame()/useVideoConfig(); use interpolate (always with \
extrapolateLeft and extrapolateRight "clamp"), spring, Easing, and remotion's random("seed") instead of \
Math.random. No Date, no timers, no useEffect-driven animation.
- Size everything relative to width/height (e.g. fontSize: width * 0.06) so it fits any aspect ratio. \
If the brief's sizes look small for the frame, go bigger: the hero text of a scene is at least \
height * 0.1 and should own the frame. Keep text inside a 6% safe margin and make sure the longest line fits: measure generously, let text \
wrap with a maxWidth, never let it run off screen. Text must read on a phone: body text at least \
min(width, height) * 0.035, small labels at least min(width, height) * 0.022; an end card's wordmark is big \
(at least a fifth of the frame width).
- Fill the frame on every frame (solid or designed background). Motion should feel intentional: \
entrances in the first ~15% with springs or eased curves, a readable hold, and a clean exit or hold at \
the end (the editor adds transitions between scenes). Stagger elements; avoid everything moving at once.
- Use the exact on-screen text from the brief, spelled exactly. Follow the shared style precisely so \
consecutive scenes look like one film.

Reply with the complete file in a single ```tsx code block and nothing else."""

REVIEW_PROMPT = """Above are frames from the render of your scene, at the times shown. Look at them \
as a strict art director would before this goes to a client, against the brief and the style:
- text cut off, overflowing, touching the edges, or a word split or partly hidden;
- shapes, boxes or lines overlapping letters in a way that reads as a rendering glitch rather than design;
- overlapping elements, unreadable contrast, text too small to read on a phone;
- empty, black or broken frames (other than a deliberate fade at the very start or end);
- weak composition: hero text that is small for the frame, or a mostly empty frame that looks unfinished;
- typos versus the brief, elements the brief asks for that are missing;
- anything that looks unfinished, accidental or off-style.
If the scene is good, reply with exactly: OK
Otherwise reply with the complete corrected file in a single ```tsx code block."""


# A request Muse Wonder never answers would otherwise wait the SDK's 10 minutes, then twice more on retry,
# with nothing on screen. These are generous for a reasoning model; a timeout becomes a SceneError the
# agent sees and can retry.
STORYBOARD_TIMEOUT = 240
SCENE_TIMEOUT = 300


def _client(timeout: float = SCENE_TIMEOUT) -> AsyncOpenAI:
    return AsyncOpenAI(api_key=settings.meta_api_key, base_url=settings.meta_base_url, timeout=timeout, max_retries=1)


async def _ask_wonder(timeout: float, what: str, **kwargs: Any) -> Any:
    try:
        return await _client(timeout).responses.create(model=WONDER, **kwargs)
    except APITimeoutError:
        raise SceneError(f"Muse Wonder didn't answer the {what} within {timeout // 60:.0f} minutes; ask again") from None


def image_data_url(path: Path, longest: int | None = None) -> str:
    """A project image as a data URL (optionally downscaled, for the model)."""
    if longest is None:
        return "data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode()
    from PIL import Image
    import io

    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((longest, longest))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


@dataclass
class ImageRef:
    id: str
    name: str
    path: Path

    def size(self) -> tuple[int, int]:
        from PIL import Image

        with Image.open(self.path) as im:
            return im.size


# --- storyboard -----------------------------------------------------------------------------------

def _clamp_duration(seconds: float | None) -> float:
    return max(MIN_SECONDS, min(MAX_SECONDS, seconds or 60))


async def write_storyboard(
    instruction: str, aspect: str, images: list[ImageRef], current: Storyboard | None,
    duration: float | None, add_cost: Callable[[float], None],
) -> Storyboard:
    """A new storyboard, or `current` revised by the instruction."""
    target = _clamp_duration(duration or (current.duration if current else None))
    text = [f"Aspect ratio: {aspect}. Target length: {target:.0f} seconds.", f"Request: {instruction}"]
    if current:
        text.append("Current storyboard (revise it):\n" + json.dumps(
            {"brief": current.brief, "style": current.style,
             "scenes": [s.model_dump(include={"id", "title", "duration", "brief", "images"}) for s in current.scenes]},
            ensure_ascii=False, indent=1,
        ))
    content: list[dict[str, Any]] = [{"type": "input_text", "text": "\n\n".join(text)}]
    if images:
        content.append({"type": "input_text", "text": "Images the user attached to the project:"})
        for im in images:
            w, h = im.size()
            content.append({"type": "input_text", "text": f"{im.id} ({im.name}, {w}x{h}):"})
            content.append({"type": "input_image", "image_url": image_data_url(im.path, 768)})

    r = await _ask_wonder(
        STORYBOARD_TIMEOUT, "storyboard", instructions=STORYBOARD_SYSTEM, input=[{"role": "user", "content": content}],
        reasoning={"effort": "medium"},
        text={"format": {"type": "json_schema", "name": "storyboard", "schema": STORYBOARD_SCHEMA, "strict": True}},
    )
    add_cost(costs.wonder(r.usage))
    try:
        data = json.loads(r.output_text)
    except json.JSONDecodeError as e:
        raise SceneError(f"Muse Wonder returned a storyboard that isn't JSON: {e}") from None
    return merge_storyboard(current, instruction if not current else current.brief, data, {im.id for im in images})


def merge_storyboard(current: Storyboard | None, brief: str, data: dict, image_ids: set[str]) -> Storyboard:
    """Build the new storyboard, keeping code and renders of scenes whose content didn't change."""
    old = {s.id: s for s in current.scenes} if current else {}
    scenes: list[StoryScene] = []
    for item in data.get("scenes", []):
        duration = round(max(1.0, min(20.0, float(item.get("duration") or 4))), 2)
        fields = {
            "title": str(item.get("title") or "Scene").strip()[:80],
            "duration": duration,
            "brief": str(item.get("brief") or "").strip(),
            "images": [i for i in item.get("images") or [] if i in image_ids],
        }
        prev = old.get(item.get("id") or "")
        if prev and prev.id not in {s.id for s in scenes}:
            unchanged = all(getattr(prev, k) == v for k, v in fields.items())
            scenes.append(prev if unchanged else prev.model_copy(update={**fields, "status": "draft", "error": None}))
        else:
            scenes.append(StoryScene(id=new_id("scene"), **fields))
    if not scenes:
        raise SceneError("The storyboard came back without scenes")
    style = str(data.get("style") or (current.style if current else "")).strip()
    if current and style != current.style:
        # A new style touches every scene.
        scenes = [s.model_copy(update={"status": "draft"}) if s.status == "ready" else s for s in scenes]
    return Storyboard(brief=brief, style=style, scenes=scenes)


# --- one scene --------------------------------------------------------------------------------------

def _extract_code(text: str) -> str:
    blocks = re.findall(r"```(?:tsx|typescript|ts|jsx|javascript|js)?\s*\n(.*?)```", text, re.S)
    if blocks:
        return max(blocks, key=len).strip()
    return text.strip()


async def run_renderer(job: dict[str, Any], on_progress: Callable[[float], None] | None = None) -> None:
    """Run motion/render.mjs on one job; raises SceneError with the renderer's message."""
    proc = await asyncio.create_subprocess_exec(
        "node", str(MOTION_DIR / "render.mjs"), cwd=MOTION_DIR,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    assert proc.stdin and proc.stdout and proc.stderr
    proc.stdin.write(json.dumps(job).encode())
    await proc.stdin.drain()
    proc.stdin.close()
    stderr_task = asyncio.create_task(proc.stderr.read())
    result: dict[str, Any] | None = None
    async for raw in proc.stdout:
        try:
            line = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if "progress" in line and on_progress:
            on_progress(float(line["progress"]))
        elif "ok" in line:
            result = line
    await proc.wait()
    stderr = (await stderr_task).decode(errors="replace")
    if result is None:
        tail = "\n".join(stderr.strip().splitlines()[-5:])
        raise SceneError(f"The renderer stopped without a result: {tail or f'exit code {proc.returncode}'}")
    if not result.get("ok"):
        raise SceneError(str(result.get("error")))


def _frames(video: Path, duration: float, workdir: Path, count: int = 6) -> list[tuple[float, Path]]:
    out = []
    for i, frac in enumerate((0.1, 0.3, 0.5, 0.7, 0.85, 0.97)[:count]):
        t = round(duration * frac, 2)
        f = workdir / f"frame{i}.jpg"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(video), "-frames:v", "1",
             "-vf", "scale='if(gt(iw,ih),768,-2)':'if(gt(iw,ih),-2,768)'", "-q:v", "4", str(f)],
            check=True,
        )
        out.append((t, f))
    return out


@dataclass
class SceneBuild:
    code: str
    video: Path
    notes: list[str]


async def build_scene(
    board: Storyboard, scene: StoryScene, size: tuple[int, int], fps: float, images: dict[str, ImageRef],
    workdir: Path, add_cost: Callable[[float], None], note: str | None = None,
    log: Callable[[str], None] = lambda _: None,
) -> SceneBuild:
    """Write (or revise) a scene's code with Muse Wonder and render it, fixing compile errors, render
    errors and what Wonder sees wrong in frames of its own render."""
    width, height = size
    frames = max(1, round(scene.duration * fps))
    index = board.scenes.index(scene)
    outline = "\n".join(
        f"{'>> ' if s.id == scene.id else '   '}{i + 1}. {s.title} ({s.duration:g}s): {s.brief}"
        for i, s in enumerate(board.scenes)
    )
    used = [images[i] for i in scene.images if i in images]
    task = (
        f"Video: {board.brief}\nShared style: {board.style}\n\nAll scenes (you build the one marked >>):\n{outline}\n\n"
        f"Build scene {index + 1}: \"{scene.title}\".\nBrief: {scene.brief}\n"
        f"Canvas: {width}x{height}, {fps:g} fps, {frames} frames ({scene.duration:g} s)."
    )
    content: list[dict[str, Any]] = [{"type": "input_text", "text": task}]
    if used:
        content.append({"type": "input_text", "text": "Images available in `images` (use these ids):"})
        for im in used:
            w, h = im.size()
            content.append({"type": "input_text", "text": f'images["{im.id}"]: {im.name}, {w}x{h}'})
            content.append({"type": "input_image", "image_url": image_data_url(im.path, 768)})
    if scene.code and note:
        content.append({"type": "input_text", "text": f"Current code of this scene:\n```tsx\n{scene.code}\n```\n\nChange requested: {note}"})
    elif scene.code:
        content.append({"type": "input_text", "text": f"The brief changed. Current code, to update:\n```tsx\n{scene.code}\n```"})
    elif note:
        content.append({"type": "input_text", "text": f"Also: {note}"})
    items: list[Any] = [{"role": "user", "content": content}]

    async def ask(effort: str) -> str:
        async with _writes:
            r = await _ask_wonder(SCENE_TIMEOUT, "scene", instructions=SCENE_SYSTEM, input=items, reasoning={"effort": effort})
        add_cost(costs.wonder(r.usage))
        items.extend(o.model_dump(exclude_none=True) for o in r.output if o.type == "message")
        return r.output_text

    job = {"width": width, "height": height, "fps": fps, "durationInFrames": frames,
           "images": {im.id: image_data_url(im.path) for im in used}}
    notes: list[str] = []
    good: SceneBuild | None = None  # the last version that rendered, kept if a later fix breaks it
    code = _extract_code(await ask("medium"))
    for attempt in range(1, CODE_TRIES + 1):
        out = workdir / f"{scene.id}-{attempt}.mp4"
        try:
            async with _renders:
                await run_renderer({**job, "code": code, "out": str(out)})
        except SceneError as e:
            notes.append(f"try {attempt}: {str(e)[:300]}")
            log(f"Scene {index + 1}: {str(e)[:160]}")
            if attempt == CODE_TRIES:
                if good:
                    notes.append("kept the version before the last fix")
                    return SceneBuild(code=good.code, video=good.video, notes=notes)
                raise SceneError(f"Scene {index + 1} still fails after {CODE_TRIES} tries: {e}") from None
            items.append({"role": "user", "content": f"That code failed:\n{e}\n\nFix it and reply with the complete file."})
            code = _extract_code(await ask("low"))
            continue
        if good is not None or attempt == CODE_TRIES:
            return SceneBuild(code=code, video=out, notes=notes)
        good = SceneBuild(code=code, video=out, notes=[])
        # Look at the result once: the cheapest way to catch clipped or overlapping text.
        with tempfile.TemporaryDirectory() as tmp:
            shots = await asyncio.to_thread(_frames, out, scene.duration, Path(tmp))
            review: list[dict[str, Any]] = []
            for t, f in shots:
                review.append({"type": "input_text", "text": f"t={t}s"})
                review.append({"type": "input_image", "image_url": "data:image/jpeg;base64," + base64.b64encode(f.read_bytes()).decode()})
        review.append({"type": "input_text", "text": REVIEW_PROMPT})
        items.append({"role": "user", "content": review})
        answer = await ask("low")
        if answer.strip().upper().startswith("OK") and "```" not in answer:
            notes.append("checked its own frames: OK")
            return SceneBuild(code=code, video=out, notes=notes)
        notes.append("checked its own frames and fixed the scene")
        log(f"Scene {index + 1}: Muse Wonder looked at the render and is fixing it")
        code = _extract_code(answer)
    assert good is not None
    return SceneBuild(code=good.code, video=good.video, notes=notes)


# --- the timeline -------------------------------------------------------------------------------------

def place_scenes(tl: Timeline, media: dict[str, Media], board: Storyboard) -> list[Op]:
    """Ops that put the storyboard's latest renders on the video track.

    A clip of an older render is swapped in place (keeping its transition); a scene that isn't on the
    track goes after the previous scene's clip; clips of scenes that left the storyboard are removed.
    When the track holds only scenes, it is kept in storyboard order. Footage clips are never touched."""
    ops: list[Op] = []

    def run(op: Op) -> None:
        nonlocal tl
        tl = apply(tl, op, media)
        ops.append(op)

    scene_of = {mid: m.scene_id for mid, m in media.items() if m.scene_id}
    scenes = {s.id: s for s in board.scenes}

    def index_of(scene_id: str, last: bool) -> int | None:
        hits = [i for i, c in enumerate(tl.clips) if scene_of.get(c.media_id) == scene_id]
        return (hits[-1] if last else hits[0]) if hits else None

    for c in list(tl.clips):
        sid = scene_of.get(c.media_id)
        if sid and sid not in scenes:
            run(Delete(clip_id=c.id))

    for c in list(tl.clips):
        scene = scenes.get(scene_of.get(c.media_id) or "")
        if scene and scene.media_id and scene.media_id in media and c.media_id != scene.media_id:
            i = next(k for k, x in enumerate(tl.clips) if x.id == c.id)
            clip_id = new_id("clip")
            run(Delete(clip_id=c.id))
            run(AddClip(id=clip_id, media_id=scene.media_id, src_in=0, src_out=media[scene.media_id].duration, index=i))
            if c.transition:
                run(SetTransition(clip_id=clip_id, transition=c.transition))

    for k, scene in enumerate(board.scenes):
        if not scene.media_id or scene.media_id not in media or index_of(scene.id, last=False) is not None:
            continue
        at = next((j + 1 for prev in reversed(board.scenes[:k]) if (j := index_of(prev.id, last=True)) is not None), None)
        if at is None:
            at = next((j for nxt in board.scenes[k + 1:] if (j := index_of(nxt.id, last=False)) is not None), None)
        run(AddClip(media_id=scene.media_id, src_in=0, src_out=media[scene.media_id].duration, index=at))

    if tl.clips and all(scene_of.get(c.media_id) for c in tl.clips):
        order = {s.id: k for k, s in enumerate(board.scenes)}
        wanted = sorted(tl.clips, key=lambda c: order.get(scene_of[c.media_id], len(order)))
        for i, c in enumerate(wanted):
            if tl.clips[i].id != c.id:
                run(Move(clip_id=c.id, index=i))
    return ops


def estimate_cost(board: Storyboard) -> float:
    """Rough USD to build every scene that isn't ready: one write, one look at the frames, sometimes a fix."""
    return round(COST_PER_SCENE * sum(1 for s in board.scenes if s.status != "ready"), 2)
