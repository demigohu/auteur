"""Agent tools. Each takes validated args, may commit ops to the project, and returns text for the model.

Tool names are Indonesian, matching the PRD. Every tool accepts an optional `step`: the index of the
plan step it works on, which lets the UI tick off the plan without spending extra model turns.
"""

import asyncio
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import Field

from typing import Literal

from auteur.media import media_dir
from auteur.reframe import follow_keys, out_of_frame
from auteur.render import render
from auteur.timeline import OpError, Project
from auteur.timeline.history import TrackInfo
from auteur.timeline.models import Aspect, Blur, Follow, Highlight, Model, Timeline
from auteur.timeline.ops import (
    MIN_CLIP, AddClip, AddText, Delete, DeleteText, Op, SetCrop, SetEffects, Split, Trim, apply, new_id,
)
from auteur.tracking import Track, load_track, track_media
from auteur.transcript import Transcript, cut_ranges, transcribe
from auteur.watch import watch


class ToolError(Exception):
    """A failure the model should read and recover from."""


class StopRun(Exception):
    """Ends the run, e.g. after the checker fails three times."""


@dataclass
class ToolContext:
    project: Project
    project_dir: Path
    run_id: str
    emit: Callable[[dict[str, Any]], None]
    save: Callable[[], None]
    target_duration: float | None = None
    target_aspect: Aspect | None = None
    check_failures: int = 0
    transcripts: dict[str, Transcript] = field(default_factory=dict)
    tracks: dict[str, Track] = field(default_factory=dict)

    def track(self, track_id: str) -> Track:
        if track_id not in self.tracks:
            if track_id not in self.project.tracks:
                raise ToolError(f"Track {track_id!r} not found; existing: {list(self.project.tracks)}. Call `lacak` first.")
            self.tracks[track_id] = load_track(self.project_dir, track_id)
        return self.tracks[track_id]

    def clips(self, clip_ids: list[str] | None) -> list:
        clips = self.project.timeline.clips
        if clip_ids is None:
            return list(clips)
        found = [c for c in clips if c.id in clip_ids]
        if missing := set(clip_ids) - {c.id for c in found}:
            raise ToolError(f"Clips not found: {sorted(missing)}")
        return found

    def commit(self, label: str, ops: list[Op]) -> None:
        try:
            self.project.commit("agent", label, ops, run_id=self.run_id)
        except OpError as e:
            raise ToolError(str(e)) from None
        self.save()
        self.emit({"type": "timeline", "label": label})


class ToolArgs(Model):
    step: int | None = Field(None, description="Index (0-based) of the plan step this call works on")


@dataclass
class Tool:
    name: str
    description: str
    args: type[ToolArgs]
    run: Callable[[ToolContext, Any], Awaitable[str]]


def describe_timeline(p: Project) -> str:
    tl = p.timeline
    lines = [f"aspect {tl.aspect}, duration {tl.duration:.2f}s, {len(tl.clips)} clips, {len(tl.texts)} texts"]
    for c, start in zip(tl.clips, tl.clip_starts()):
        extras = []
        if c.grade.model_dump(exclude_defaults=True):
            extras.append(f"grade {c.grade.model_dump(exclude_defaults=True)}")
        if c.crop:
            extras.append(f"{len(c.crop)} crop keys")
        if c.effects:
            extras.append(f"effects {[e.kind for e in c.effects]}")
        if c.muted:
            extras.append("muted")
        lines.append(
            f"  {c.id}: {c.media_id} src {c.src_in:.2f}-{c.src_out:.2f} -> timeline {start:.2f}-{start + c.duration:.2f}"
            + (f" ({'; '.join(extras)})" if extras else "")
        )
    for t in tl.texts[:30]:
        lines.append(f"  {t.id} [{t.style}] {t.start:.2f}-{t.end:.2f}: {t.text}")
    if len(tl.texts) > 30:
        lines.append(f"  ... {len(tl.texts) - 30} more texts")
    return "\n".join(lines)


async def get_transcript(ctx: ToolContext, media_id: str) -> Transcript:
    if media_id not in ctx.transcripts:
        m = ctx.project.media.get(media_id)
        if m is None:
            raise ToolError(f"Media {media_id!r} not found; available: {list(ctx.project.media)}")
        if not m.has_audio:
            ctx.transcripts[media_id] = Transcript(duration=m.duration, turns=[], silences=[])
        else:
            cache = media_dir(ctx.project_dir, media_id) / "transcript.json"
            ctx.transcripts[media_id] = await asyncio.to_thread(transcribe, Path(m.path), cache)
    return ctx.transcripts[media_id]


# --- rencana -------------------------------------------------------------------------------------

class RencanaArgs(ToolArgs):
    steps: list[str] = Field(min_length=1, description="Short, user-facing steps in the user's language")
    target_duration: float | None = Field(None, description="Requested final length in seconds, if any")
    aspect: Aspect | None = Field(None, description="Requested output aspect, if any")


async def rencana(ctx: ToolContext, a: RencanaArgs) -> str:
    ctx.target_duration = a.target_duration or ctx.target_duration
    ctx.target_aspect = a.aspect or ctx.target_aspect
    ctx.emit({"type": "plan", "steps": a.steps})
    return "Plan shown to the user. Execute it step by step, passing `step` on each call."


# --- dengar --------------------------------------------------------------------------------------

class DengarArgs(ToolArgs):
    media_ids: list[str] | None = Field(None, description="Media to transcribe; omit for all")


async def dengar(ctx: ToolContext, a: DengarArgs) -> str:
    ids = a.media_ids or list(ctx.project.media)
    transcripts = await asyncio.gather(*(get_transcript(ctx, mid) for mid in ids))
    parts = []
    for mid, t in zip(ids, transcripts):
        m = ctx.project.media[mid]
        parts.append(f"## {mid} ({m.name}, {m.duration:.1f}s). Times are source seconds; [x] = filler\n{t.lines()}")
    return "\n\n".join(parts)


# --- susun ---------------------------------------------------------------------------------------

class ClipRange(Model):
    media_id: str
    src_in: float = Field(ge=0)
    src_out: float = Field(gt=0)


class SusunArgs(ToolArgs):
    label: str = Field(description="Short description for the history, in the user's language")
    clips: list[ClipRange] = Field(min_length=1, description="The whole video track, in story order")


async def susun(ctx: ToolContext, a: SusunArgs) -> str:
    ops: list[Op] = [Delete(clip_id=c.id) for c in ctx.project.timeline.clips]
    ops += [AddClip(media_id=c.media_id, src_in=c.src_in, src_out=c.src_out) for c in a.clips]
    ops += [DeleteText(text_id=t.id) for t in ctx.project.timeline.texts if t.style == "subtitle"]
    ctx.commit(a.label, ops)
    return "Video track rebuilt (old subtitles removed; call `subtitle` again at the end).\n" + describe_timeline(ctx.project)


# --- ubah_timeline -------------------------------------------------------------------------------

class UbahArgs(ToolArgs):
    label: str = Field(description="Short description for the history, in the user's language")
    ops: list[Op] = Field(min_length=1)


async def ubah_timeline(ctx: ToolContext, a: UbahArgs) -> str:
    ctx.commit(a.label, a.ops)
    return "Applied.\n" + describe_timeline(ctx.project)


# --- buang_filler --------------------------------------------------------------------------------

class BuangFillerArgs(ToolArgs):
    clip_ids: list[str] | None = Field(None, description="Clips to clean; omit for every clip")
    min_silence: float = Field(0.8, ge=0.3, description="Pauses longer than this many seconds are shortened")


def filler_ops(tl: Timeline, clip_id: str, cuts: list[tuple[float, float]], media: dict) -> tuple[list[Op], Timeline, float]:
    """Ops removing `cuts` (source seconds) from one clip, computed on a scratch timeline.

    Cuts run last to first so the clip keeps its id as its left part shrinks.
    """
    ops: list[Op] = []
    removed = 0.0

    def do(op: Op) -> None:
        nonlocal tl
        tl = apply(tl, op, media)
        ops.append(op)

    for a, b in sorted(cuts, reverse=True):
        i = next(i for i, c in enumerate(tl.clips) if c.id == clip_id)
        clip = tl.clips[i]
        a, b = max(a, clip.src_in), min(b, clip.src_out)
        if b - a < MIN_CLIP:
            continue
        start = tl.clip_starts()[i]
        near_in, near_out = a - clip.src_in < MIN_CLIP, clip.src_out - b < MIN_CLIP
        if near_in and near_out:
            do(Delete(clip_id=clip_id))
            removed += clip.duration
            break
        if near_in:
            do(Trim(clip_id=clip_id, src_in=b))
        elif near_out:
            do(Trim(clip_id=clip_id, src_out=a))
        else:
            middle, right = new_id("clip"), new_id("clip")
            do(Split(clip_id=clip_id, at=start + (a - clip.src_in), new_clip_id=middle))
            do(Split(clip_id=middle, at=start + (b - clip.src_in), new_clip_id=right))
            do(Delete(clip_id=middle))
        removed += b - a
    return ops, tl, removed


async def buang_filler(ctx: ToolContext, a: BuangFillerArgs) -> str:
    p = ctx.project
    ids = a.clip_ids or [c.id for c in p.timeline.clips]
    tl, ops, total, count = p.timeline, [], 0.0, 0
    for clip_id in ids:
        clip = next((c for c in tl.clips if c.id == clip_id), None)
        if clip is None:
            raise ToolError(f"Clip {clip_id!r} not found")
        cuts = cut_ranges(await get_transcript(ctx, clip.media_id), min_silence=a.min_silence)
        cuts = [(x, y) for x, y in cuts if y > clip.src_in and x < clip.src_out]
        clip_ops, tl, removed = filler_ops(tl, clip_id, cuts, p.media)
        ops += clip_ops
        total += removed
        count += len(cuts)
    if not ops:
        return "No filler words or long pauses found in those clips."
    ctx.commit(f"Buang {count} filler/jeda ({total:.1f} dtk)", ops)
    return f"Removed {count} filler/pause ranges, {total:.1f}s total.\n" + describe_timeline(p)


# --- subtitle ------------------------------------------------------------------------------------

class SubtitleArgs(ToolArgs):
    max_words: int = Field(6, ge=1, le=12, description="Words per subtitle line")
    y: float = Field(0.82, ge=0, le=1, description="Vertical position (0 top, 1 bottom)")


async def subtitle(ctx: ToolContext, a: SubtitleArgs) -> str:
    tl = ctx.project.timeline
    words: list[tuple[float, float, str]] = []
    for c, start in zip(tl.clips, tl.clip_starts()):
        if c.muted:
            continue
        t = await get_transcript(ctx, c.media_id)
        for turn in t.turns:
            for w in turn.words:
                if w.is_filler or w.end <= c.src_in or w.start >= c.src_out:
                    continue
                s = start + max(w.start, c.src_in) - c.src_in
                e = start + min(w.end, c.src_out) - c.src_in
                words.append((s, e, w.text))

    chunks: list[list[tuple[float, float, str]]] = []
    for w in sorted(words):
        cur = chunks[-1] if chunks else None
        if (
            cur is None or len(cur) >= a.max_words or w[0] - cur[-1][1] > 0.6
            or w[1] - cur[0][0] > 3.0 or cur[-1][2][-1] in ".?!"
        ):
            chunks.append([w])
        else:
            cur.append(w)

    ops: list[Op] = [DeleteText(text_id=t.id) for t in tl.texts if t.style == "subtitle"]
    for i, ch in enumerate(chunks):
        end = ch[-1][1] + 0.2
        if i + 1 < len(chunks):
            end = min(end, chunks[i + 1][0][0])
        end = min(end, tl.duration)
        if end - ch[0][0] < 0.2:
            continue
        ops.append(AddText(text=" ".join(w[2] for w in ch), start=round(ch[0][0], 3), end=round(end, 3), y=a.y))
    added = sum(isinstance(op, AddText) for op in ops)
    if not added:
        return "No speech on the timeline, so no subtitles were added."
    ctx.commit(f"Subtitle ({added} baris)", ops)
    return f"Added {added} subtitle lines."


# --- render + periksa ----------------------------------------------------------------------------

class RenderArgs(ToolArgs):
    final: bool = Field(False, description="Full resolution export; otherwise a fast half-resolution preview")


Mark = dict[str, Any]  # {"start", "end", "label"} in timeline seconds, drawn on the editor's timeline


def periksa(ctx: ToolContext, out: Path) -> tuple[list[str], list[Mark]]:
    """Checks outside the agent's control. Returns problems (empty = pass) and timeline marks."""
    from auteur.media import probe

    tl, issues, marks = ctx.project.timeline, [], []
    info = probe(out)
    if ctx.target_duration:
        tolerance = max(3.0, ctx.target_duration * 0.15)
        if abs(info["duration"] - ctx.target_duration) > tolerance:
            issues.append(
                f"Duration is {info['duration']:.1f}s but the user asked for {ctx.target_duration:.0f}s "
                f"(allowed ±{tolerance:.0f}s)"
            )
    if ctx.target_aspect and tl.aspect != ctx.target_aspect:
        issues.append(f"Aspect is {tl.aspect} but the user asked for {ctx.target_aspect}")
    if not info["has_audio"]:
        issues.append("Render has no audio track")
    if any(c.duration < 0.4 for c in tl.clips):
        issues.append("Some clips are shorter than 0.4s and will look like glitches; merge or remove them")

    # Visual checks use the SAM tracks: the subject a crop follows must stay inside the crop window,
    # and a blurred object must not appear unblurred between detections.
    out_w, out_h = tl.size
    for c, start in zip(tl.clips, tl.clip_starts()):
        m = ctx.project.media[c.media_id]
        if c.follow and c.crop:
            track = ctx.track(c.follow.track_id)
            for a, b in out_of_frame(track, c.follow.object_id, c, m, out_w, out_h):
                marks.append({"start": round(start + a, 2), "end": round(start + b, 2), "label": "Subjek keluar frame"})
                issues.append(
                    f"Subject (object {c.follow.object_id}) leaves the {tl.aspect} frame at timeline "
                    f"{start + a:.1f}-{start + b:.1f}s in clip {c.id}: the crop lags behind. "
                    f"Call `reframe` again for that clip with a smaller `halus`."
                )
        for e in c.effects:
            if not isinstance(e, Blur):
                continue
            track = ctx.track(e.track_id)
            # The blur bridges detection gaps up to 2*hold. A longer gap under 4s is most likely a missed
            # detection (a turned or covered face), not the person leaving, so the face may flash unblurred.
            # Re-tracking does not fix that; holding the blur longer does.
            worst = 0.0
            for oid in e.targets(list(track.objects)):
                frames = sorted(f for f in track.frames(oid) if c.src_in <= f / track.fps <= c.src_out)
                for f0, f1 in zip(frames, frames[1:]):
                    gap = (f1 - f0) / track.fps
                    if 2 * e.hold < gap < 4.0:
                        a, b = start + f0 / track.fps - c.src_in, start + f1 / track.fps - c.src_in
                        marks.append({"start": round(a, 2), "end": round(b, 2), "label": "Blur mungkin bocor"})
                        worst = max(worst, gap)
            if worst:
                issues.append(
                    f"Blur on track {track.id} has detection gaps up to {worst:.1f}s where a face may show unblurred "
                    f"(marked on the timeline). Call `efek` again for clip {c.id} with the same objects and "
                    f"tahan={min(4.0, round(worst / 2 + 0.25, 2))}. Do not re-run `lacak` for this."
                )
    return issues, marks


async def render_tool(ctx: ToolContext, a: RenderArgs) -> str:
    p = ctx.project
    n = sum(1 for _ in (ctx.project_dir / "renders").glob("*.mp4")) if (ctx.project_dir / "renders").exists() else 0
    rel = f"renders/{'final' if a.final else 'preview'}-{n + 1}.mp4"
    loop = asyncio.get_running_loop()

    def progress(v: float) -> None:
        loop.call_soon_threadsafe(ctx.emit, {"type": "progress", "tool": "render", "value": round(v, 3)})

    tracks = {e.track_id: ctx.track(e.track_id) for c in p.timeline.clips for e in c.effects}
    try:
        await asyncio.to_thread(
            render, p.timeline, p.media, ctx.project_dir / rel, 1.0 if a.final else 0.5, progress, tracks
        )
    except Exception as e:
        raise ToolError(f"Render failed: {e}") from None
    p.last_render = rel
    ctx.save()

    issues, marks = periksa(ctx, ctx.project_dir / rel)
    ctx.emit({"type": "check", "passed": not issues, "issues": issues, "marks": marks, "render": rel})
    if not issues:
        return f"Rendered {rel}. Checker: PASSED."
    ctx.check_failures += 1
    if ctx.check_failures >= 3:
        raise StopRun("Checker failed 3 times: " + "; ".join(issues))
    return (
        f"Rendered {rel}. Checker: FAILED ({ctx.check_failures}/3):\n- " + "\n- ".join(issues)
        + "\nFix the timeline, then render again."
    )


# --- tonton --------------------------------------------------------------------------------------

class TontonArgs(ToolArgs):
    media_ids: list[str] | None = Field(None, description="Media to watch; omit for all")
    fokus: str | None = Field(None, description="A specific visual question, e.g. 'when is the cake on screen?'")


async def tonton(ctx: ToolContext, a: TontonArgs) -> str:
    ids = a.media_ids or list(ctx.project.media)
    for mid in ids:
        if mid not in ctx.project.media:
            raise ToolError(f"Media {mid!r} not found")

    async def one(mid: str) -> str:
        m = ctx.project.media[mid]
        text = await watch(m, media_dir(ctx.project_dir, mid) / "scenes.txt", a.fokus)
        return f"## {mid} ({m.name}, {m.duration:.1f}s, {m.width}x{m.height}). Times are source seconds\n{text}"

    return "\n\n".join(await asyncio.gather(*(one(mid) for mid in ids)))


# --- lacak ---------------------------------------------------------------------------------------

class LacakArgs(ToolArgs):
    media_id: str
    prompt: str = Field(description="Short English noun phrase for SAM, e.g. 'person', 'face', 'license plate', 'dog'")


async def lacak(ctx: ToolContext, a: LacakArgs) -> str:
    if a.media_id not in ctx.project.media:
        raise ToolError(f"Media {a.media_id!r} not found")
    prompt = a.prompt.strip().lower()
    existing = next((t for t in ctx.project.tracks.values() if t.media_id == a.media_id and t.prompt == prompt), None)
    if existing:
        track = ctx.track(existing.id)
    else:
        loop = asyncio.get_running_loop()

        def progress(v: float) -> None:
            loop.call_soon_threadsafe(ctx.emit, {"type": "progress", "tool": "lacak", "value": round(v, 3)})

        try:
            track = await track_media(ctx.project_dir, a.media_id, new_id("track"), prompt, progress)
        except Exception as e:
            raise ToolError(f"Tracking failed: {e}") from None
        ctx.tracks[track.id] = track
        ctx.project.tracks[track.id] = TrackInfo(
            id=track.id, media_id=a.media_id, prompt=prompt, object_ids=list(track.objects)
        )
        ctx.save()
        ctx.emit({"type": "track", "track_id": track.id})
    rows = "\n".join(
        f"  object {r['object_id']}: {r['seconds']}s, on screen {r['coverage']:.0%}, "
        f"size {r['avg_size']:.0%} of frame, x={r['avg_x']}"
        for r in track.summary()
    )
    return (
        f"Track {track.id} for '{prompt}' on {a.media_id}: {len(track.objects)} objects "
        f"(ranked, likely main subject first; times are source seconds):\n{rows or '  none found'}"
    )


# --- reframe -------------------------------------------------------------------------------------

class ReframeArgs(ToolArgs):
    track_id: str
    object_id: str | None = Field(None, description="Object to follow; omit for the track's main subject")
    clip_ids: list[str] | None = Field(None, description="Clips to reframe (must use the track's media); omit for all")
    halus: float = Field(
        1.5, ge=0.1, le=4, description="Smoothing in seconds: higher = calmer camera, lower = follows fast motion"
    )


async def reframe(ctx: ToolContext, a: ReframeArgs) -> str:
    track = ctx.track(a.track_id)
    oid = a.object_id or track.main_object()
    if oid is None or oid not in track.objects:
        raise ToolError(f"Object {a.object_id!r} not in track; objects: {[r['object_id'] for r in track.summary()]}")
    clips = [c for c in ctx.clips(a.clip_ids) if c.media_id == track.media_id]
    if not clips:
        raise ToolError(f"No clips on the timeline use {track.media_id}")
    ops: list[Op] = [
        SetCrop(clip_id=c.id, keys=follow_keys(track, oid, c, a.halus), follow=Follow(track_id=track.id, object_id=oid))
        for c in clips
    ]
    ctx.commit(f"Reframe {ctx.project.timeline.aspect} mengikuti subjek", ops)
    return f"Crop on {len(clips)} clips now follows object {oid} (halus {a.halus}s).\n" + describe_timeline(ctx.project)


# --- efek ----------------------------------------------------------------------------------------

class EfekArgs(ToolArgs):
    jenis: Literal["blur", "sorot"] = Field(description="blur = hide objects (faces, plates); sorot = dim everything else")
    track_id: str
    object_ids: list[str] | None = Field(None, description="Objects to affect; omit for every object in the track")
    kecuali: list[str] = Field(
        default_factory=list,
        description="Blur only: objects to leave clear, e.g. the main subject. Prefer this over listing object_ids "
        "for 'blur everyone except X', so faces that appear later are blurred too.",
    )
    clip_ids: list[str] | None = Field(None, description="Clips to apply to (must use the track's media); omit for all")
    kekuatan: float = Field(0.7, ge=0, le=1)
    tahan: float = Field(1.0, ge=0.3, le=4, description="Blur only: seconds to hold the blur across missed detections")


async def efek(ctx: ToolContext, a: EfekArgs) -> str:
    track = ctx.track(a.track_id)
    clips = [c for c in ctx.clips(a.clip_ids) if c.media_id == track.media_id]
    if not clips:
        raise ToolError(f"No clips on the timeline use {track.media_id}")
    new = (
        Blur(track_id=track.id, object_ids=a.object_ids, exclude_ids=a.kecuali, strength=a.kekuatan, hold=a.tahan)
        if a.jenis == "blur"
        else Highlight(track_id=track.id, object_ids=a.object_ids, dim_background=a.kekuatan * 0.7)
    )
    ops: list[Op] = []
    for c in clips:
        # Replace an earlier effect of the same kind on the same track instead of stacking them.
        kept = [e for e in c.effects if not (e.kind == new.kind and e.track_id == track.id)]
        ops.append(SetEffects(clip_id=c.id, effects=[*kept, new]))
    ctx.commit(f"{'Blur' if a.jenis == 'blur' else 'Sorot'} '{track.prompt}'", ops)
    return f"{a.jenis} applied to {len(clips)} clips. It shows in the render and as an overlay in the editor preview."


TOOLS = [
    Tool("rencana", "Show the edit plan to the user. Call this first, once, before editing.", RencanaArgs, rencana),
    Tool("dengar", "Transcribe media with per-turn and estimated per-word times; filler words are marked.", DengarArgs, dengar),
    Tool(
        "tonton",
        "Watch media: scene-by-scene description of what is on screen, with energy 1-5. Use it to pick visual moments.",
        TontonArgs, tonton,
    ),
    Tool(
        "lacak",
        "Track objects through a media file with SAM 3.1 (boxes per frame). Slow: 1-3 minutes. Needed before "
        "reframe and efek. Reuses an existing track for the same media and prompt.",
        LacakArgs, lacak,
    ),
    Tool(
        "reframe",
        "Make clips' crop follow a tracked object, for the current timeline aspect (set the aspect first). "
        "If the checker reports the subject leaving the frame, call again for those clips with a smaller `halus`.",
        ReframeArgs, reframe,
    ),
    Tool("efek", "Blur tracked objects (faces, license plates) or highlight them by dimming the rest.", EfekArgs, efek),
    Tool("susun", "Replace the whole video track with the given source ranges, in story order.", SusunArgs, susun),
    Tool(
        "ubah_timeline",
        "Apply low-level timeline ops (trim, split, move, delete, text, grade, crop, aspect...). "
        "Use for revisions and anything the other tools don't cover. Times: `split.at` is timeline time; "
        "`src_in`/`src_out` are source seconds; grade values are -1..1 (exposure -2..2), subtle is ±0.1-0.3.",
        UbahArgs, ubah_timeline,
    ),
    Tool("buang_filler", "Cut filler words (eh, hmm...) and long pauses from clips, using the transcript.", BuangFillerArgs, buang_filler),
    Tool("subtitle", "(Re)generate subtitles from the transcript for everything on the timeline. Call after cutting.", SubtitleArgs, subtitle),
    Tool(
        "render",
        "Render the timeline. An automatic checker then verifies it against the request; on FAILED, fix and render again.",
        RenderArgs, render_tool,
    ),
]
TOOLS_BY_NAME = {t.name: t for t in TOOLS}


def _inline_refs(schema: dict) -> dict:
    defs = schema.pop("$defs", {})

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                return walk(defs[node["$ref"].split("/")[-1]])
            # The discriminator mapping points into $defs, which no longer exist once inlined.
            return {k: walk(v) for k, v in node.items() if k not in ("title", "discriminator")}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node

    return walk(schema)


def tool_specs() -> list[dict]:
    return [
        {"type": "function", "name": t.name, "description": t.description, "parameters": _inline_refs(t.args.model_json_schema())}
        for t in TOOLS
    ]


def parse_args(tool: Tool, raw: str) -> ToolArgs:
    try:
        return tool.args.model_validate(json.loads(raw or "{}"))
    except (ValueError, json.JSONDecodeError) as e:
        raise ToolError(f"Invalid arguments for {tool.name}: {e}") from None
