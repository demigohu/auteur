"""Agent tools. Each takes validated args, may commit ops to the project, and returns text for the model.

Tool names are Indonesian, matching the PRD. Every tool accepts an optional `step`: the index of the
plan step it works on, which lets the UI tick off the plan without spending extra model turns.
"""

import asyncio
import json
from datetime import UTC, datetime
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import Field

from typing import Literal

from auteur import colorist, costs, motion, reference, subtitles
from auteur import grade as G
from auteur.media import ingest, load_beats, media_dir
from auteur.reframe import follow_keys, out_of_frame
from auteur.render import render
from auteur.timeline import OpError, Project
from auteur.timeline.history import CheckMark, CheckResult, TrackInfo
from auteur.timeline.models import (
    Aspect, Blur, Follow, Grade, Highlight, Model, OverlayLayout, TextLook, TextWord, Timeline, Transition, Zoom,
)
from auteur.timeline.ops import (
    MIN_CLIP, AddAudio, AddClip, AddOverlay, AddText, Delete, DeleteAudio, DeleteOverlay, DeleteText, Op, SetCrop,
    SetEffects, SetFinish, SetGrade, SetSpeed, SetTransition, SetZoom, SpeedRamp, Split, Trim, apply, new_id,
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
    cost: float = 0.0
    frames: colorist.FrameCache = field(default_factory=dict)
    match_requested: bool = False
    reference_id: str | None = None  # set by grade with a reference: the checker then measures the match
    reference_fit: dict[str, float] = field(default_factory=dict)  # clip id -> distance the match reached
    beat_every: int | None = None  # set by potong_di_beat: the checker then keeps cuts on the beat
    attached: list[str] = field(default_factory=list)  # reference images attached to this instruction
    budget: float | None = None  # USD this run may spend under the spend caps (None = no cap)

    def add_cost(self, usd: float) -> None:
        if usd <= 0:
            return
        self.cost += usd
        self.project.spent += usd
        self.emit({"type": "cost", "run": round(self.cost, 4), "total": round(self.project.spent, 4)})

    def track(self, track_id: str) -> Track:
        if track_id not in self.tracks:
            if track_id not in self.project.tracks:
                raise ToolError(f"Track {track_id!r} not found; existing: {list(self.project.tracks)}. Call `track` first.")
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
    lines = [f"aspect {tl.aspect}, {tl.fps:g}fps, duration {tl.duration:.2f}s, {len(tl.clips)} clips, {len(tl.texts)} texts"]
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
        if c.speed != 1:
            extras.append(f"speed {c.speed}x")
        if c.transition:
            extras.append(f"{c.transition.kind} in {c.transition.duration}s")
        if c.zoom:
            extras.append(f"zoom {c.zoom.start}->{c.zoom.end}")
        if c.transform:
            extras.append(f"transform {c.transform.model_dump(exclude_defaults=True)}")
        if c.crop_rect:
            extras.append(f"edges cut {c.crop_rect.model_dump(exclude_defaults=True)}")
        if c.volume != 1:
            extras.append(f"volume {c.volume}")
        lines.append(
            f"  {c.id}: {c.media_id} src {c.src_in:.2f}-{c.src_out:.2f} -> timeline {start:.2f}-{start + c.duration:.2f}"
            + (f" ({'; '.join(extras)})" if extras else "")
        )
    for o in tl.overlays:
        place = f"box {o.box.model_dump()}" if o.box else o.layout
        lines.append(f"  B-roll {o.id}: {o.media_id} src {o.src_in:.2f}-{o.src_out:.2f} at {o.start:.2f}-{o.end:.2f} ({place})")
    for a in tl.audio:
        lines.append(
            f"  Music {a.id}: {a.media_id} src {a.src_in:.2f}-{a.src_out:.2f} at {a.start:.2f}, volume {a.volume}"
            + (", ducks under speech" if a.duck else "")
        )
    if tl.finish.letterbox or tl.finish.grain:
        lines.append(f"  Finish: letterbox {tl.finish.letterbox}, grain {tl.finish.grain}")
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
            fresh = not cache.exists()
            ctx.transcripts[media_id] = await asyncio.to_thread(transcribe, Path(m.path), cache)
            if fresh:
                ctx.add_cost(costs.transcribe(m.duration))
    return ctx.transcripts[media_id]


# --- plan -----------------------------------------------------------------------------------------

class RencanaArgs(ToolArgs):
    steps: list[str] = Field(min_length=1, description="Short, user-facing steps in the user's language")
    target_duration: float | None = Field(None, description="Requested final length in seconds, if any")
    aspect: Aspect | None = Field(None, description="Requested output aspect, if any")


async def rencana(ctx: ToolContext, a: RencanaArgs) -> str:
    ctx.target_duration = a.target_duration or ctx.target_duration
    ctx.target_aspect = a.aspect or ctx.target_aspect
    ctx.emit({"type": "plan", "steps": a.steps})
    return "Plan shown to the user. Execute it step by step, passing `step` on each call."


# --- listen ---------------------------------------------------------------------------------------

class DengarArgs(ToolArgs):
    media_ids: list[str] | None = Field(None, description="Media to transcribe; omit for all")


async def dengar(ctx: ToolContext, a: DengarArgs) -> str:
    ids = a.media_ids or [m.id for m in ctx.project.media.values() if m.kind == "video" and not m.scene_id]
    transcripts = await asyncio.gather(*(get_transcript(ctx, mid) for mid in ids))
    parts = []
    for mid, t in zip(ids, transcripts):
        m = ctx.project.media[mid]
        parts.append(f"## {mid} ({m.name}, {m.duration:.1f}s). Times are source seconds; [x] = filler\n{t.lines()}")
    return "\n\n".join(parts)


# --- assemble -------------------------------------------------------------------------------------

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
    return "Video track rebuilt (old subtitles removed; call `subtitles` again at the end).\n" + describe_timeline(ctx.project)


# --- edit_timeline --------------------------------------------------------------------------------

class UbahArgs(ToolArgs):
    label: str = Field(description="Short description for the history, in the user's language")
    ops: list[Op] = Field(min_length=1)


async def ubah_timeline(ctx: ToolContext, a: UbahArgs) -> str:
    ctx.commit(a.label, a.ops)
    return "Applied.\n" + describe_timeline(ctx.project)


# --- remove_fillers -------------------------------------------------------------------------------

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
            removed += clip.src_duration
            break
        if near_in:
            do(Trim(clip_id=clip_id, src_in=b))
        elif near_out:
            do(Trim(clip_id=clip_id, src_out=a))
        else:
            middle, right = new_id("clip"), new_id("clip")
            do(Split(clip_id=clip_id, at=start + clip.to_local(a), new_clip_id=middle))
            do(Split(clip_id=middle, at=start + clip.to_local(b), new_clip_id=right))
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
    ctx.commit(f"Remove {count} fillers/pauses ({total:.1f}s)", ops)
    return f"Removed {count} filler/pause ranges, {total:.1f}s total.\n" + describe_timeline(p)


# --- subtitles ------------------------------------------------------------------------------------

DEFAULT_Y = {"clean": 0.82, "bold": 0.74, "karaoke": 0.74, "box": 0.74, "pop": 0.7}


class SubtitleArgs(ToolArgs):
    style: TextLook = Field(
        "karaoke",
        description="clean: plain white; bold: big bold caps; karaoke: the spoken word lights up (creator style); "
        "box: spoken word in a color box; pop: words appear as they are spoken",
    )
    color: str = Field("#FFD43B", pattern=r"^#[0-9a-fA-F]{6}$", description="Accent color for highlighted words")
    max_words: int = Field(5, ge=1, le=12, description="Max words per subtitle (3-5 suits vertical video)")
    y: float | None = Field(None, ge=0.05, le=0.95, description="Vertical center (0 top, 1 bottom); default per style")
    fix_words: bool = Field(True, description="Fix misheard words, casing and punctuation with Muse Spark")
    emphasize: bool = Field(True, description="Color one key word per line")


async def subtitle(ctx: ToolContext, a: SubtitleArgs) -> str:
    tl = ctx.project.timeline
    words: list[tuple[float, float, str]] = []
    scenes: list[str] = []
    for c, start in zip(tl.clips, tl.clip_starts()):
        if not c.has_sound:
            continue
        t = await get_transcript(ctx, c.media_id)
        for turn in t.turns:
            for w in turn.words:
                if w.is_filler or w.end <= c.src_in or w.start >= c.src_out:
                    continue
                s = start + c.to_local(max(w.start, c.src_in))
                e = start + c.to_local(min(w.end, c.src_out))
                words.append((s, e, w.text))
        cached = media_dir(ctx.project_dir, c.media_id) / "scenes.txt"
        if cached.exists() and cached.read_text() not in scenes:
            scenes.append(cached.read_text())
    if not words:
        return "No speech on the timeline, so no subtitles were added."

    out_w, out_h = tl.size
    groups = subtitles.chunk(words, a.max_words)
    texts = [" ".join(w[2] for w in g) for g in groups]
    emphasis: list[list[str]] = [[] for _ in groups]
    if a.fix_words or a.emphasize:
        fixed, usd = await subtitles.correct(texts, "\n".join(scenes), a.emphasize)
        ctx.add_cost(usd)
        if a.fix_words:
            texts = [t for t, _ in fixed]
        emphasis = [e for _, e in fixed]

    # Re-time corrected words, then wrap with real font metrics (may split long chunks further).
    timed = [subtitles.timed_words(g, t, e) for g, t, e in zip(groups, texts, emphasis)]
    retimed = [[(w.start, w.end, w.text) for w in tw] for tw in timed]
    marks = {(w.start, w.text) for tw in timed for w in tw if w.emphasis}
    fitted = subtitles.fit(retimed, a.style, out_w, out_h)

    y = a.y if a.y is not None else DEFAULT_Y[a.style]
    ops: list[Op] = [DeleteText(text_id=t.id) for t in tl.texts if t.style == "subtitle"]
    for i, (ws, text) in enumerate(fitted):
        end = ws[-1][1] + 0.25
        if i + 1 < len(fitted):
            end = min(end, fitted[i + 1][0][0][0])
        end = min(end, tl.duration)
        if end - ws[0][0] < 0.2:
            continue
        ops.append(AddText(
            text=text, start=round(ws[0][0], 3), end=round(end, 3), look=a.style, color=a.color, y=y,
            words=[TextWord(text=w[2], start=round(w[0], 3), end=round(w[1], 3), emphasis=(w[0], w[2]) in marks) for w in ws],
        ))
    added = sum(isinstance(op, AddText) for op in ops)
    ctx.commit(f"Subtitles: {a.style} ({added} lines)", ops)
    sample = "\n".join(f"  {t.replace(chr(10), ' / ')}" for _, t in fitted[:6])
    return f"Added {added} subtitles ({a.style}, corrected={a.fix_words}). First lines:\n{sample}"


# --- render + checker -----------------------------------------------------------------------------

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
                marks.append({"start": round(start + a, 2), "end": round(start + b, 2), "label": "Subject leaves frame"})
                issues.append(
                    f"Subject (object {c.follow.object_id}) leaves the {tl.aspect} frame at timeline "
                    f"{start + a:.1f}-{start + b:.1f}s in clip {c.id}: the crop lags behind. "
                    f"Call `reframe` again for that clip with a smaller `smoothing`."
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
                        a, b = start + c.to_local(f0 / track.fps), start + c.to_local(f1 / track.fps)
                        marks.append({"start": round(a, 2), "end": round(b, 2), "label": "Blur may leak"})
                        worst = max(worst, gap)
            if worst:
                issues.append(
                    f"Blur on track {track.id} has detection gaps up to {worst:.1f}s where a face may show unblurred "
                    f"(marked on the timeline). Call `effect` again for clip {c.id} with the same objects and "
                    f"hold={min(4.0, round(worst / 2 + 0.25, 2))}. Do not re-run `track` for this."
                )

    # Color: the grade must not burn highlights or crush shadows that the source still had, and
    # clips the user asked to match must actually match. Measured on sampled source frames through
    # the exact grade the renderer applies, so no extra render is needed.
    graded = [(c, s) for c, s in zip(tl.clips, tl.clip_starts()) if not G.is_identity(c.grade)]
    lumas: list[tuple[str, float, float, float]] = []
    ref_info = ctx.project.references.get(ctx.reference_id or "")
    ref_features = (
        reference.features(reference.load(ctx.project_dir / "refs" / f"{ref_info.id}.jpg")) if ref_info else None
    )
    for c, start in graded:
        f = colorist.clip_frames(ctx.frames, ctx.project.media[c.media_id], c)
        before, after = G.stats(f), G.stats(G.apply(c.grade, f))
        span = (round(start, 2), round(start + c.duration, 2))
        if after["clipped"] > 0.04 and after["clipped"] - before["clipped"] > 0.03:
            marks.append({"start": span[0], "end": span[1], "label": "Clipped highlights"})
            issues.append(
                f"Clip {c.id}: the grade burns {after['clipped']:.0%} of the frame to pure white "
                f"(source: {before['clipped']:.0%}). Call `grade` for it with adjust "
                f'{{"exposure": -0.2, "highlights": -0.3}} or a lower intensity.'
            )
        if after["crushed"] > 0.08 and after["crushed"] - before["crushed"] > 0.05:
            marks.append({"start": span[0], "end": span[1], "label": "Crushed shadows"})
            issues.append(
                f"Clip {c.id}: the grade crushes {after['crushed']:.0%} of the frame to black "
                f"(source: {before['crushed']:.0%}). Call `grade` for it with adjust "
                f'{{"shadows": 0.3}} or a lower intensity.'
            )
        if ref_features is not None and c.id in ctx.reference_fit:
            # Judged against what the match reached, not an absolute bar: a forest never gets as close to a
            # beach sunset as to another forest. Only a later change that undid the match is a problem.
            gap = reference.distance(reference.features(G.apply(c.grade, f)), ref_features)
            if gap > ctx.reference_fit[c.id] + 0.12:
                marks.append({"start": span[0], "end": span[1], "label": "Lost the reference look"})
                issues.append(
                    f"Clip {c.id} drifted from the look of {ref_info.name} (distance {gap:.2f}, the match reached "
                    f"{ctx.reference_fit[c.id]:.2f}); a later edit overrode its grade. Call `grade` for it with "
                    f"reference_id={ref_info.id}."
                )
        lumas.append((c.id, after["luma"], *span))
    if ctx.match_requested:
        # Loose on purpose: a montage may cut from a night street to a stage; only real jumps count.
        for (a, la, _, _), (b, lb, s, e) in zip(lumas, lumas[1:]):
            if abs(la - lb) > 0.18:
                marks.append({"start": s, "end": e, "label": "Color mismatch"})
                issues.append(
                    f"Clips {a} and {b} differ in brightness ({la:.2f} vs {lb:.2f}) although they should "
                    f"match. Call `grade` on all clips with match=true."
                )

    # Beat sync: once cuts were put on the beat, later trims must not knock them off it.
    if ctx.beat_every and tl.audio and len(tl.clips) > 1:
        music = tl.audio[0]
        beats = load_beats(ctx.project_dir, music.media_id)
        grid = [music.start + b - music.src_in for b in beats.beats[:: ctx.beat_every] if b >= music.src_in]
        off = [(s, min(abs(s - g) for g in grid)) for s in tl.clip_starts()[1:] if grid]
        late = [(s, d) for s, d in off if d > 0.08]
        for s, _ in late:
            marks.append({"start": round(max(0, s - 0.15), 2), "end": round(s + 0.15, 2), "label": "Cut off the beat"})
        if late:
            issues.append(
                f"{len(late)} cuts are off the beat by up to {max(d for _, d in late):.2f}s (edits after potong_di_beat). "
                f"Call `cut_on_beat` again (tiap {ctx.beat_every}) after your last trim."
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
    p.last_check = CheckResult(
        passed=not issues, issues=issues, marks=[CheckMark(**m) for m in marks], render=rel,
        run_id=ctx.run_id, head=p.history[-1].id if p.history else None, at=datetime.now(UTC),
    )
    ctx.save()
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


# --- grade ---------------------------------------------------------------------------------------

Look = Literal["warm", "cinematic", "film", "moody", "vintage", "black_white", "bright", "cool"]
LOOK_ID = {"warm": "hangat", "black_white": "hitam_putih", "bright": "cerah", "cool": "dingin"}


class WarnaArgs(ToolArgs):
    clip_ids: list[str] | None = Field(None, description="Clips to grade; omit for all")
    look: Look | None = Field(None, description="Preset look; omit for correction only")
    reference_id: str | None = Field(
        None,
        description="A reference image to match (the user's attached still, by id). Fits each clip's tone curve, "
        "contrast, saturation, color cast and split-toning to it, measured; replaces `look`",
    )
    intensity: float = Field(0.7, ge=0, le=1, description="How strongly the look or the reference match is applied")
    auto_correct: bool = Field(True, description="First correct exposure and white balance from the footage")
    match: bool = Field(True, description="Match brightness and warmth across the clips")
    log: Literal["none", "apple_log", "slog3", "vlog", "generic"] = Field(
        "none",
        description="Camera log profile of the footage (flat, gray-looking). The result tells you when footage "
        "looks like log; use generic when the camera is unknown",
    )
    adjust: dict[str, float] = Field(
        default_factory=dict,
        description="Extra adjustments added on top, e.g. {\"exposure\": -0.2, \"vignette\": 0.3}. Fields: "
        + ", ".join(colorist.NUMERIC) + " (shadow_hue/highlight_hue in degrees)",
    )


async def warna(ctx: ToolContext, a: WarnaArgs) -> str:
    clips = ctx.clips(a.clip_ids)
    if not clips:
        raise ToolError("No clips on the timeline")
    unknown = set(a.adjust) - set(colorist.NUMERIC) - set(colorist.HUES)
    if unknown:
        raise ToolError(f"Unknown grade fields {sorted(unknown)}; use {colorist.NUMERIC}")
    if a.reference_id is not None:
        return await _grade_to_reference(ctx, a, clips)
    results = await asyncio.to_thread(
        colorist.grade_clips, ctx.project.media, clips, LOOK_ID.get(a.look, a.look) if a.look else None, a.intensity, a.auto_correct,
        a.match, a.adjust, ctx.frames, a.log,
    )
    if a.match and len(clips) > 1:
        ctx.match_requested = True
    label = colorist.LOOK_LABELS.get(LOOK_ID.get(a.look or "", a.look or ""), "Correction")
    ctx.commit(f"Color: {label}", [SetGrade(clip_ids=[cid], grade=g) for cid, g, _, _ in results])
    lines = [
        f"  {cid}: {G.describe(before)}\n    -> {G.describe(after)}"
        + ("\n    (source looks flat, like log footage: consider log='generic' or the camera's profile)"
           if a.log == "none" and G.looks_like_log(before) else "")
        for cid, _, before, after in results
    ]
    return f"Graded {len(results)} clips ({label}, intensity {a.intensity}). Measured on sampled frames:\n" + "\n".join(lines)


async def _grade_to_reference(ctx: ToolContext, a: WarnaArgs, clips: list) -> str:
    ref_info = ctx.project.references.get(a.reference_id or "")
    if ref_info is None:
        raise ToolError(f"Reference image {a.reference_id!r} not found; use an id from the state message")
    ref = reference.load(ctx.project_dir / "refs" / f"{ref_info.id}.jpg")
    results = await asyncio.to_thread(
        colorist.match_reference, ctx.project.media, clips, ref, a.intensity, a.auto_correct, ctx.frames, a.log,
    )
    grades = []
    for cid, g, _, _ in results:
        if a.adjust:
            values = g.model_dump(exclude={"look", "log"})
            for k, v in a.adjust.items():
                values[k] = values[k] + v if k in colorist.NUMERIC else v
            g = Grade(**colorist.clamp_grade(values), log=g.log)
        grades.append((cid, g))
    ctx.reference_id = ref_info.id
    ctx.reference_fit.update({cid: after for cid, _, _, after in results})
    ctx.commit(f"Color: match {ref_info.name}", [SetGrade(clip_ids=[cid], grade=g) for cid, g in grades])
    lines = [f"  {cid}: {before:.2f} -> {after:.2f} ({reference.closeness(after)})" for cid, _, before, after in results]
    return (
        f"Matched {len(results)} clips to {ref_info.name} at strength {a.intensity}. The reference measures: "
        f"{reference.describe(ref)}.\nDistance to the reference (0 = identical look):\n" + "\n".join(lines)
        + "\nThe match copies tone and palette, not the scene's lighting. For grain, letterbox or vignette that "
        "you see in the reference, use `cinematic_finish` or `adjust`."
        + (
            "\nSome clips stay far from the reference because their content differs from it (other colors in the "
            "scene, not a grading problem). This is as close as the palette goes: tell the user, do not regrade."
            if any(after >= 0.3 for *_, after in results) else ""
        )
    )


# --- music ----------------------------------------------------------------------------------------

class MusikArgs(ToolArgs):
    media_id: str = Field(description="An uploaded audio file")
    start_at: float = Field(0, ge=0, description="Where in the song to start, in seconds (skip a slow intro)")
    volume: float = Field(0.8, ge=0, le=2)
    duck: bool = Field(True, description="Lower the music while someone speaks")
    replace: bool = Field(True, description="Replace music already on the timeline")


async def musik(ctx: ToolContext, a: MusikArgs) -> str:
    m = ctx.project.media.get(a.media_id)
    if m is None or m.kind != "audio":
        raise ToolError(f"{a.media_id!r} is not an uploaded audio file; audio media: "
                        f"{[x.id for x in ctx.project.media.values() if x.kind == 'audio']}")
    ops: list[Op] = [DeleteAudio(audio_id=x.id) for x in ctx.project.timeline.audio] if a.replace else []
    ops.append(AddAudio(media_id=m.id, src_in=a.start_at, volume=a.volume, duck=a.duck))
    ctx.commit(f"Music: {m.name}", ops)
    beats = await asyncio.to_thread(load_beats, ctx.project_dir, m.id)
    on_timeline = [round(b - a.start_at, 2) for b in beats.beats if b >= a.start_at][:24]
    down = [round(b - a.start_at, 2) for b in beats.downbeats if b >= a.start_at][:8]
    return (
        f"Music {m.name} placed from its {a.start_at:.1f}s. Tempo {beats.bpm} BPM "
        f"(a beat every {60 / beats.bpm if beats.bpm else 0:.2f}s). Timeline beat times: {on_timeline}... "
        f"bar starts: {down}... Use `cut_on_beat` to land the cuts on these."
    )


# --- cut_on_beat ----------------------------------------------------------------------------------

class PotongDiBeatArgs(ToolArgs):
    every: Literal[1, 2, 4] = Field(2, description="Cut on every Nth beat: 1 = fast and punchy, 4 = calm (once per bar)")


async def potong_di_beat(ctx: ToolContext, a: PotongDiBeatArgs) -> str:
    tl = ctx.project.timeline
    if not tl.audio:
        raise ToolError("No music on the timeline; call `music` first")
    music = tl.audio[0]
    beats = await asyncio.to_thread(load_beats, ctx.project_dir, music.media_id)
    grid = [music.start + b - music.src_in for b in beats.beats[:: a.every] if b >= music.src_in]
    if len(grid) < 2:
        raise ToolError("The music has too few detectable beats")
    # Walk the cuts left to right; every change shifts the clips after it, so recompute each time.
    ops: list[Op] = []
    scratch, moved = tl, 0
    for i in range(len(scratch.clips) - 1):
        starts = scratch.clip_starts()
        clip, nxt = scratch.clips[i], scratch.clips[i + 1]
        overlap = nxt.transition.duration if nxt.transition and nxt.transition.overlaps else 0
        cut = starts[i + 1]
        candidates = [g for g in grid if g > starts[i] + 0.5]
        if not candidates:
            break
        target = min(candidates, key=lambda g: abs(g - cut))
        new_local = target - starts[i] + overlap
        m = ctx.project.media[clip.media_id]
        src_out = round(min(clip.src_in + new_local * clip.speed, m.duration), 3)
        if abs(target - cut) < 0.02 or src_out - clip.src_in < 0.3:
            continue
        op = Trim(clip_id=clip.id, src_out=src_out)
        scratch = apply(scratch, op, ctx.project.media)
        ops.append(op)
        moved += 1
    ctx.beat_every = a.every
    if not ops:
        return "Cuts already sit on the beat grid."
    ctx.commit(f"Cut on the beat (every {a.every} beats)", ops)
    return f"Moved {moved} cuts onto every {a.every} beat(s).\n" + describe_timeline(ctx.project)


# --- transitions, speed, zoom, cinematic_finish ---------------------------------------------------

TRANSITION_LABEL = {
    "crossfade": "crossfade", "dip_black": "dip to black", "dip_white": "dip to white", "cut": "hard cut",
    "slide_left": "slide left", "slide_right": "slide right", "slide_up": "slide up", "slide_down": "slide down",
    "wipe_left": "wipe left", "wipe_right": "wipe right", "circle": "circle", "zoom": "zoom",
}


class TransisiArgs(ToolArgs):
    kind: Literal[
        "crossfade", "dip_black", "dip_white", "slide_left", "slide_right", "slide_up", "slide_down",
        "wipe_left", "wipe_right", "circle", "zoom", "cut",
    ] = Field(
        description="crossfade blends clips (calm, cinematic); dip_black/dip_white dip through black/white; slide_* "
        "push the old shot out (energetic, social); wipe_* reveal with a moving edge; circle opens from the center; "
        "zoom punches into the old shot; cut removes transitions (hard cut)"
    )
    duration: float = Field(0.5, ge=0.1, le=2)
    clip_ids: list[str] | None = Field(None, description="Clips that get the transition INTO them; omit for every cut")


async def transisi(ctx: ToolContext, a: TransisiArgs) -> str:
    tl = ctx.project.timeline
    ids = a.clip_ids or [c.id for c in tl.clips[1:]]
    ops: list[Op] = []
    for cid in ids:
        i = next((k for k, c in enumerate(tl.clips) if c.id == cid), None)
        if i is None:
            raise ToolError(f"Clip {cid!r} not found")
        if a.kind == "cut":
            ops.append(SetTransition(clip_id=cid, transition=None))
            continue
        if i == 0 and a.kind not in ("dip_black", "dip_white"):
            continue  # the first clip has nothing to overlap with
        limit = min(tl.clips[i].duration, tl.clips[i - 1].duration if i else tl.clips[i].duration) / 2
        ops.append(SetTransition(clip_id=cid, transition=Transition(kind=a.kind, duration=round(min(a.duration, limit), 2))))
    if not ops:
        return "No transitions to set."
    ctx.commit(f"Transition: {TRANSITION_LABEL[a.kind]}", ops)
    return f"Set {a.kind} on {len(ops)} cuts.\n" + describe_timeline(ctx.project)


class KecepatanArgs(ToolArgs):
    clip_ids: list[str]
    speed: float = Field(ge=0.25, le=4, description="0.5 = slow motion (best on 60fps footage), 2-4 = time-lapse feel")
    ramp_at: float | None = Field(
        None, description="Speed ramp: timeline time (inside the single clip given) where the clip eases from its "
        "current speed into `speed`, the classic 'normal then slow motion' move",
    )
    ramp_duration: float = Field(0.6, ge=0.2, le=3, description="Seconds the ramp takes")


async def kecepatan(ctx: ToolContext, a: KecepatanArgs) -> str:
    if a.ramp_at is not None:
        if len(a.clip_ids) != 1:
            raise ToolError("A speed ramp works on exactly one clip")
        ctx.commit(f"Speed ramp to {a.speed}x", [SpeedRamp(clip_id=a.clip_ids[0], at=a.ramp_at, to_speed=a.speed, ramp=a.ramp_duration)])
        return f"Ramped into {a.speed}x from {a.ramp_at:.2f}s over {a.ramp_duration}s.\n" + describe_timeline(ctx.project)
    ctx.commit(f"Speed {a.speed}x", [SetSpeed(clip_id=c.id, speed=a.speed) for c in ctx.clips(a.clip_ids)])
    slow = [c for c in ctx.clips(a.clip_ids) if a.speed < 1 and ctx.project.media[c.media_id].fps < 50]
    note = (f" Note: {[c.id for c in slow]} were shot below 50fps, so slow motion will look a bit choppy."
            if slow else "")
    return f"Speed {a.speed}x on {len(a.clip_ids)} clips (their audio is muted).{note}\n" + describe_timeline(ctx.project)


class ZoomArgs(ToolArgs):
    clip_ids: list[str]
    from_scale: float = Field(1.0, ge=1, le=2, description="Scale at the clip's start")
    to_scale: float = Field(1.15, ge=1, le=2, description="Scale at its end; from_scale > to_scale zooms out")
    hapus: bool = False


async def zoom(ctx: ToolContext, a: ZoomArgs) -> str:
    z = None if a.hapus else Zoom(start=a.from_scale, end=a.to_scale)
    ctx.commit("Slow zoom" if z else "Remove zoom", [SetZoom(clip_id=c.id, zoom=z) for c in ctx.clips(a.clip_ids)])
    return f"Zoom {'removed' if z is None else f'{a.from_scale}->{a.to_scale}'} on {len(a.clip_ids)} clips."


class SinematikArgs(ToolArgs):
    letterbox: float | None = Field(2.39, ge=1.5, le=3, description="Cinema bar ratio (2.39 scope, 1.85 flat); null for none")
    grain: float = Field(0.3, ge=0, le=1, description="Film grain, 0.2-0.4 is subtle")


async def sinematik(ctx: ToolContext, a: SinematikArgs) -> str:
    ctx.commit("Cinematic finish", [SetFinish(letterbox=a.letterbox, grain=a.grain)])
    vertical = ctx.project.timeline.aspect in ("9:16", "4:5")
    return (f"Letterbox {a.letterbox}, grain {a.grain}."
            + (" The video is vertical, so bars leave a wide strip in the middle; that is a deliberate style." if vertical and a.letterbox else ""))


# --- broll ---------------------------------------------------------------------------------------

class BrollItem(Model):
    media_id: str
    src_in: float = Field(ge=0)
    src_out: float = Field(gt=0)
    start: float = Field(ge=0, description="Timeline time it appears")
    layout: OverlayLayout = "full"


class BrollArgs(ToolArgs):
    items: list[BrollItem] = Field(min_length=1)
    replace: bool = Field(False, description="Remove existing B-roll first")


async def broll(ctx: ToolContext, a: BrollArgs) -> str:
    ops: list[Op] = [DeleteOverlay(overlay_id=o.id) for o in ctx.project.timeline.overlays] if a.replace else []
    ops += [AddOverlay(**it.model_dump()) for it in a.items]
    ctx.commit(f"B-roll ({len(a.items)})", ops)
    return f"Placed {len(a.items)} B-roll clips over the main track (muted, the main audio keeps playing).\n" + describe_timeline(ctx.project)


# --- watch ----------------------------------------------------------------------------------------

class TontonArgs(ToolArgs):
    media_ids: list[str] | None = Field(None, description="Media to watch; omit for all")
    focus: str | None = Field(None, description="A specific visual question, e.g. 'when is the cake on screen?'")


async def tonton(ctx: ToolContext, a: TontonArgs) -> str:
    ids = a.media_ids or [m.id for m in ctx.project.media.values() if m.kind == "video" and not m.scene_id]
    for mid in ids:
        if mid not in ctx.project.media or ctx.project.media[mid].kind != "video":
            raise ToolError(f"{mid!r} is not a video in this project")

    async def one(mid: str) -> str:
        m = ctx.project.media[mid]
        text, usd = await watch(m, media_dir(ctx.project_dir, mid) / "scenes.txt", a.focus)
        ctx.add_cost(usd)
        return f"## {mid} ({m.name}, {m.duration:.1f}s, {m.width}x{m.height}). Times are source seconds\n{text}"

    return "\n\n".join(await asyncio.gather(*(one(mid) for mid in ids)))


# --- track ----------------------------------------------------------------------------------------

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
            loop.call_soon_threadsafe(ctx.emit, {"type": "progress", "tool": "track", "value": round(v, 3)})

        try:
            track = await track_media(ctx.project_dir, a.media_id, new_id("track"), prompt, progress)
        except Exception as e:
            raise ToolError(f"Tracking failed: {e}") from None
        ctx.tracks[track.id] = track
        ctx.add_cost(costs.sam(track.total_frames))
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
    smoothing: float = Field(
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
        SetCrop(clip_id=c.id, keys=follow_keys(track, oid, c, a.smoothing), follow=Follow(track_id=track.id, object_id=oid))
        for c in clips
    ]
    ctx.commit(f"Reframe {ctx.project.timeline.aspect} to follow the subject", ops)
    return f"Crop on {len(clips)} clips now follows object {oid} (smoothing {a.smoothing}s).\n" + describe_timeline(ctx.project)


# --- effect ----------------------------------------------------------------------------------------

class EfekArgs(ToolArgs):
    kind: Literal["blur", "highlight"] = Field(description="blur = hide objects (faces, plates); highlight = dim everything else")
    track_id: str
    object_ids: list[str] | None = Field(None, description="Objects to affect; omit for every object in the track")
    except_ids: list[str] = Field(
        default_factory=list,
        description="Blur only: objects to leave clear, e.g. the main subject. Prefer this over listing object_ids "
        "for 'blur everyone except X', so faces that appear later are blurred too.",
    )
    clip_ids: list[str] | None = Field(None, description="Clips to apply to (must use the track's media); omit for all")
    strength: float = Field(0.7, ge=0, le=1)
    hold: float = Field(1.0, ge=0.3, le=4, description="Blur only: seconds to hold the blur across missed detections")


async def efek(ctx: ToolContext, a: EfekArgs) -> str:
    track = ctx.track(a.track_id)
    clips = [c for c in ctx.clips(a.clip_ids) if c.media_id == track.media_id]
    if not clips:
        raise ToolError(f"No clips on the timeline use {track.media_id}")
    new = (
        Blur(track_id=track.id, object_ids=a.object_ids, exclude_ids=a.except_ids, strength=a.strength, hold=a.hold)
        if a.kind == "blur"
        else Highlight(track_id=track.id, object_ids=a.object_ids, dim_background=a.strength * 0.7)
    )
    ops: list[Op] = []
    for c in clips:
        # Replace an earlier effect of the same kind on the same track instead of stacking them.
        kept = [e for e in c.effects if not (e.kind == new.kind and e.track_id == track.id)]
        ops.append(SetEffects(clip_id=c.id, effects=[*kept, new]))
    ctx.commit(f"{'Blur' if a.kind == 'blur' else 'Highlight'} '{track.prompt}'", ops)
    return f"{a.kind} applied to {len(clips)} clips. It shows in the render and as an overlay in the editor preview."


# --- videos made in code: storyboard, build_scenes ----------------------------------------------------

class StoryboardArgs(ToolArgs):
    instruction: str = Field(
        description="What the video is, or what to change in the current storyboard. Include every fact the "
        "user gave (names, numbers, wording, audience, tone); the storyboard may only use those facts."
    )
    duration: float | None = Field(None, ge=5, le=180, description="Target length in seconds; default 60, or the current length")
    image_ids: list[str] | None = Field(
        None, description="Reference images the video may show (screenshots, logos). Default: the ones attached to this instruction"
    )


def _images(ctx: ToolContext) -> dict[str, motion.ImageRef]:
    return {
        r.id: motion.ImageRef(r.id, r.name, ctx.project_dir / "refs" / f"{r.id}.jpg")
        for r in ctx.project.references.values()
    }


def describe_storyboard(board) -> str:
    lines = [f"Storyboard, {len(board.scenes)} scenes, {board.duration:g}s. Style: {board.style}"]
    for i, s in enumerate(board.scenes):
        extra = f" [{s.status}{': ' + s.error if s.error else ''}]"
        imgs = f" images {s.images}" if s.images else ""
        lines.append(f"  {i + 1}. {s.id} \"{s.title}\" {s.duration:g}s{extra}{imgs}: {s.brief}")
    return "\n".join(lines)


async def storyboard(ctx: ToolContext, a: StoryboardArgs) -> str:
    p = ctx.project
    ids = a.image_ids if a.image_ids is not None else ctx.attached
    images = _images(ctx)
    if missing := [i for i in ids if i not in images]:
        raise ToolError(f"Unknown images {missing}; the project has {list(images)}")
    try:
        board = await motion.write_storyboard(
            a.instruction, p.timeline.aspect, [images[i] for i in ids], p.storyboard, a.duration, ctx.add_cost,
        )
    except motion.SceneError as e:
        raise ToolError(str(e)) from None
    p.storyboard = board
    ctx.save()
    ctx.emit({"type": "timeline", "label": "Storyboard"})
    todo = sum(1 for s in board.scenes if s.status != "ready")
    return (
        describe_storyboard(board)
        + f"\n\n{todo} scenes to build, roughly ${motion.estimate_cost(board):.2f} with Muse Wonder. "
        "Call `build_scenes` next (it builds every scene that isn't ready)."
    )


class SceneNote(Model):
    scene_id: str
    note: str = Field(description="What to change in this scene, e.g. 'make the headline bigger, slower entrance'")


class BuildScenesArgs(ToolArgs):
    scene_ids: list[str] | None = Field(None, description="Scenes to (re)build; omit for every scene that isn't ready")
    notes: list[SceneNote] = Field(default_factory=list, description="Change requests; those scenes are rebuilt from their current code")


def _set_scene(board, scene_id: str, **update) -> None:
    for i, s in enumerate(board.scenes):
        if s.id == scene_id:
            board.scenes[i] = s.model_copy(update=update)


async def build_scenes(ctx: ToolContext, a: BuildScenesArgs) -> str:
    p = ctx.project
    board = p.storyboard
    if board is None:
        raise ToolError("No storyboard yet; call `storyboard` first.")
    notes = {n.scene_id: n.note for n in a.notes}
    ids = a.scene_ids or [s.id for s in board.scenes if s.status != "ready" or not s.media_id]
    ids = list(dict.fromkeys([*ids, *notes]))
    if missing := [i for i in ids if board.scene(i) is None]:
        raise ToolError(f"Unknown scenes {missing}; the storyboard has {[s.id for s in board.scenes]}")
    if board.duration > motion.MAX_SECONDS:
        raise ToolError(f"The storyboard is {board.duration:g}s; videos made in code go up to {motion.MAX_SECONDS}s. Shorten it first.")
    estimate = motion.COST_PER_SCENE * len(ids)
    if ctx.budget is not None and ctx.cost + estimate > ctx.budget:
        left = max(0.0, ctx.budget - ctx.cost)
        raise ToolError(
            f"Building {len(ids)} scenes costs about ${estimate:.2f} and this account has ${left:.2f} left of its spend cap. "
            f"Build at most {int(left // motion.COST_PER_SCENE)} scenes (pass scene_ids), or shorten the storyboard."
        )
    if ids:
        for sid in ids:
            _set_scene(board, sid, status="building", error=None)
        ctx.save()
        ctx.emit({"type": "timeline", "label": "Building scenes"})

    workdir = ctx.project_dir / "scenes"
    workdir.mkdir(parents=True, exist_ok=True)  # a blank project has no folder until something is saved in it
    images = _images(ctx)
    done = 0
    results: list[str] = []

    async def one(sid: str) -> None:
        nonlocal done
        scene = board.scene(sid)
        assert scene is not None
        number = board.scenes.index(scene) + 1
        try:
            built = await motion.build_scene(
                board, scene, p.timeline.size, p.timeline.fps, images, workdir, ctx.add_cost, notes.get(sid),
                log=lambda text: ctx.emit({"type": "thought", "text": text}),
            )
            media_id = new_id("media")
            m = await asyncio.to_thread(ingest, ctx.project_dir, media_id, f"Scene {number}: {scene.title}", built.video)
            p.media[media_id] = m.model_copy(update={"scene_id": sid})
            _set_scene(board, sid, code=built.code, media_id=media_id, status="ready", error=None)
            results.append(f"  {number}. {sid} ready ({'; '.join(built.notes) or 'first try'})")
        except (motion.SceneError, OSError) as e:
            _set_scene(board, sid, status="failed", error=str(e)[:400])
            results.append(f"  {number}. {sid} FAILED: {str(e)[:300]}")
        done += 1
        ctx.emit({"type": "progress", "value": round(done / len(ids), 2)})
        ctx.save()
        ctx.emit({"type": "timeline", "label": f"Scene {number}"})

    try:
        await asyncio.gather(*(one(sid) for sid in ids))
    finally:
        # A stopped run leaves no scene stuck in "building".
        for s in board.scenes:
            if s.status == "building":
                _set_scene(board, s.id, status="draft")
        ctx.save()

    ops = motion.place_scenes(p.timeline, p.media, board)
    if ops:
        ctx.commit("Scenes on the timeline", ops)
    failed = [s for s in board.scenes if s.status == "failed"]
    summary = "\n".join(sorted(results, key=lambda r: int(r.split(".")[0]))) or "  (nothing to build)"
    tail = (
        f"\n{len(failed)} scenes failed; rebuild them with a note that addresses the error, or simplify their brief with `storyboard`."
        if failed else ""
    )
    return f"Built scenes:\n{summary}{tail}\n\n" + describe_timeline(p)


# --- generate_image -------------------------------------------------------------------------------

class GenerateImageArgs(ToolArgs):
    prompt: str = Field(description="What the picture shows, its style and mood; in English works best")
    add_at: float | None = Field(None, ge=0, description="Timeline time to put it on the video track (as a still clip); omit to only add it to the media bin")
    seconds: float = Field(3, ge=0.5, le=30, description="How long the still stays on screen when added")


async def generate_image(ctx: ToolContext, a: GenerateImageArgs) -> str:
    from auteur import imagegen  # noqa: PLC0415

    media_id = new_id("media")
    try:
        m = await asyncio.to_thread(imagegen.generate, ctx.project_dir, media_id, a.prompt, ctx.project.timeline.aspect)
    except imagegen.ImageGenError as e:
        raise ToolError(str(e)) from None
    ctx.project.media[m.id] = m
    ctx.add_cost(imagegen.PRICE)
    if a.add_at is None:
        ctx.save()
        ctx.emit({"type": "timeline", "label": "Generated picture"})
        return f"Generated {m.id} ({m.width}x{m.height}) into the media bin."
    tl = ctx.project.timeline
    index = sum(1 for c, s in zip(tl.clips, tl.clip_starts()) if s + c.duration / 2 <= a.add_at)
    ctx.commit("Generated picture", [AddClip(media_id=m.id, src_in=0, src_out=a.seconds, index=index)])
    return f"Generated {m.id} and put it on the video track for {a.seconds:g}s.\n" + describe_timeline(ctx.project)


# --- translate_texts --------------------------------------------------------------------------------

class TranslateArgs(ToolArgs):
    language: str = Field(description="Target language, e.g. 'English', 'Indonesian', 'Spanish'")
    subtitles_only: bool = Field(True, description="False also translates titles and captions")


async def translate_texts(ctx: ToolContext, a: TranslateArgs) -> str:
    from auteur import translate  # noqa: PLC0415

    try:
        ops, usd = await translate.translate_ops(ctx.project, a.language, a.subtitles_only)
    except translate.TranslateError as e:
        raise ToolError(str(e)) from None
    ctx.add_cost(usd)
    if not ops:
        return f"Everything is already in {a.language}."
    ctx.commit(f"Translate to {a.language}", ops)
    return f"Translated {len(ops)} texts into {a.language}."


# --- voiceover, dub ----------------------------------------------------------------------------------

class VoiceoverArgs(ToolArgs):
    text: str = Field(description="What to say")
    language: str = Field("English", description="English, Indonesian, Spanish, French, German, Portuguese, Dutch, Tagalog, "
                          "Vietnamese, Malay, Javanese, Sundanese, Swahili, Turkish or Polish")
    at: float = Field(0, ge=0, description="Timeline time it starts")
    voice: Literal["natural", "deeper", "brighter"] = "natural"
    speed: float = Field(1, ge=0.5, le=2)


async def voiceover(ctx: ToolContext, a: VoiceoverArgs) -> str:
    import tempfile  # noqa: PLC0415

    from auteur import tts  # noqa: PLC0415

    with tempfile.TemporaryDirectory() as tmp:
        try:
            wav = await asyncio.to_thread(tts.voiceover, a.text, a.language, a.voice, a.speed, Path(tmp) / "voice.wav")
        except tts.TTSError as e:
            raise ToolError(str(e)) from None
        m = await asyncio.to_thread(ingest, ctx.project_dir, new_id("media"), f"Voice: {' '.join(a.text.split())[:40]}", wav)
    ctx.project.media[m.id] = m
    ctx.commit("Voice-over", [AddAudio(media_id=m.id, start=a.at, volume=1, fade_in=0.05, fade_out=0.2, duck=False)])
    return f"Voice-over of {m.duration:.1f}s at {a.at:.2f}s (Meta MMS-TTS, {a.language}). Music under it is not ducked automatically; lower it if needed."


# --- remove_background --------------------------------------------------------------------------------

class RemoveBackgroundArgs(ToolArgs):
    clip_ids: list[str] = Field(min_length=1)
    prompt: str = Field("person", description="What to keep, as a short noun phrase for SAM: 'person', 'dog', 'car'")
    keep: Literal["main", "all"] = Field("main", description="main: only the subject (biggest match); all: every match")
    backdrop: Literal["blur", "color"] = "blur"
    color: str = Field("#000000", pattern=r"^#[0-9a-fA-F]{6}$", description="Backdrop color when backdrop is color")


async def remove_background(ctx: ToolContext, a: RemoveBackgroundArgs) -> str:
    from auteur import masks  # noqa: PLC0415
    from auteur.timeline.models import Backdrop, BgRemove  # noqa: PLC0415
    from auteur.timeline.ops import SetBgRemove  # noqa: PLC0415

    clips = ctx.clips(a.clip_ids)
    for mid in dict.fromkeys(c.media_id for c in clips):
        try:
            _, frames = await masks.make_mask(ctx.project_dir, mid, a.prompt, a.keep)
        except masks.MaskError as e:
            raise ToolError(str(e)) from None
        ctx.add_cost(costs.sam(frames))
    spec = BgRemove(prompt=a.prompt, keep=a.keep, backdrop=Backdrop(kind=a.backdrop, color=a.color))
    ctx.commit("Remove background", [SetBgRemove(clip_id=c.id, bg_remove=spec) for c in clips])
    return f"Background replaced ({a.backdrop}) behind the {a.prompt} in {len(clips)} clips, using SAM 3.1 masks."


# --- freeze_frame ----------------------------------------------------------------------------------

class FreezeArgs(ToolArgs):
    clip_id: str
    at: float = Field(ge=0, description="Timeline time of the frame to hold")
    duration: float = Field(2, ge=0.2, le=30, description="Seconds to hold it")


async def freeze_frame(ctx: ToolContext, a: FreezeArgs) -> str:
    from auteur import freeze  # noqa: PLC0415

    try:
        ops = await asyncio.to_thread(freeze.freeze, ctx.project, ctx.project_dir, a.clip_id, a.at, a.duration)
    except freeze.FreezeError as e:
        raise ToolError(str(e)) from None
    ctx.commit(f"Freeze frame {a.duration:g}s", ops)
    return f"Held the frame at {a.at:.2f}s for {a.duration:g}s.\n" + describe_timeline(ctx.project)


TOOLS = [
    Tool("plan", "Show the edit plan to the user. Call this first, once, before editing.", RencanaArgs, rencana),
    Tool("listen", "Transcribe media with per-turn and estimated per-word times; filler words are marked.", DengarArgs, dengar),
    Tool(
        "watch",
        "Watch media: scene-by-scene description of what is on screen, with energy 1-5. Use it to pick visual moments.",
        TontonArgs, tonton,
    ),
    Tool(
        "track",
        "Track objects through a media file with SAM 3.1 (boxes per frame). Slow: 1-3 minutes. Needed before "
        "reframe and effect. Reuses an existing track for the same media and prompt.",
        LacakArgs, lacak,
    ),
    Tool(
        "reframe",
        "Make clips' crop follow a tracked object, for the current timeline aspect (set the aspect first). "
        "If the checker reports the subject leaving the frame, call again for those clips with a smaller `smoothing`.",
        ReframeArgs, reframe,
    ),
    Tool(
        "grade",
        "Color grade clips: automatic exposure/white-balance correction, matching across clips, and a preset look "
        "(warm, cinematic, film, moody, vintage, black_white, bright, cool) at an intensity, plus fine adjustments. "
        "Returns measured brightness/clipping before and after. Use this for any color request instead of set_grade.",
        WarnaArgs, warna,
    ),
    Tool(
        "music",
        "Put an uploaded song under the video (ducks under speech by default) and get its tempo and beat times.",
        MusikArgs, musik,
    ),
    Tool("cut_on_beat", "Move the cuts between clips onto the music's beat grid. Call after `assemble` and `music`.",
         PotongDiBeatArgs, potong_di_beat),
    Tool("transitions", "Set transitions between clips: crossfade, slide, wipe, circle, zoom, dip to black/white, or plain cuts.",
         TransisiArgs, transisi),
    Tool("speed", "Change clip speed: slow motion (0.5) or sped up (2-4), or a speed ramp into it with "
         "ramp_mulai. Sped/slowed clips are muted.",
         KecepatanArgs, kecepatan),
    Tool("zoom", "Slow push-in (or pull-out) over clips, Ken Burns style.", ZoomArgs, zoom),
    Tool("generate_image", "Make a picture from a prompt with Muse Image (title backgrounds, illustrations, "
         "establishing shots, thumbnails); optionally put it on the video track.", GenerateImageArgs, generate_image),
    Tool("translate_texts", "Translate the subtitles (or all on-screen text) into another language; word timing "
         "is kept per line. Make subtitles first.", TranslateArgs, translate_texts),
    Tool("voiceover", "Speak a text (Meta MMS-TTS, one voice per language, pitch variants) and put it on the music "
         "track at a time: narration, intros, calls to action.", VoiceoverArgs, voiceover),
    Tool("remove_background", "Cut the subject out with SAM 3.1 pixel masks and replace the background with a blur or "
         "a color (no green screen needed). 15-60 s per minute of footage.", RemoveBackgroundArgs, remove_background),
    Tool("freeze_frame", "Hold the picture at a moment of a clip for a few seconds (a still of that frame goes in), "
         "e.g. to land a beat or put a title over a stopped shot.", FreezeArgs, freeze_frame),
    Tool("cinematic_finish", "Cinema finishing for the whole video: letterbox bars and film grain.", SinematikArgs, sinematik),
    Tool(
        "broll",
        "Lay B-roll over the main track at given timeline times (full frame or picture-in-picture corners), "
        "e.g. show what the speaker talks about while their voice continues.",
        BrollArgs, broll,
    ),
    Tool("effect", "Blur tracked objects (faces, license plates) or highlight them by dimming the rest.", EfekArgs, efek),
    Tool("assemble", "Replace the whole video track with the given source ranges, in story order.", SusunArgs, susun),
    Tool(
        "edit_timeline",
        "Apply low-level timeline ops (trim, split, move, delete, text, grade, crop, aspect...). "
        "Use for revisions and anything the other tools don't cover: set_transform (move/scale/rotate/flip/opacity), "
        "set_transform_keys (animate those), set_clip_anim (entrance/exit: fade, zoom, slide, spin), set_crop_rect (cut "
        "edges), set_fit (whole picture over a blurred or colored backdrop, e.g. landscape footage in 9:16), set_reverse, "
        "set_lut (a project LUT), set_audio_fade, set_audio_clean (denoise 0-1, voice: clearer speech), detach_audio, "
        "set_bg_remove (only to change the backdrop or turn it off; remove_background makes the mask), update_overlay "
        "(box, opacity, blend, chroma: key out a green/blue screen), update_audio (audio_clean too), and text style "
        "(font, text_color, size, outline, shadow, background, anim_in/anim_out). With linkage on, text and B-roll follow "
        "the clip they sit on when clips are cut, trimmed or moved. Times: `split.at` is timeline time; "
        "`src_in`/`src_out` are source seconds; grade values are -1..1 (exposure -2..2), subtle is ±0.1-0.3.",
        UbahArgs, ubah_timeline,
    ),
    Tool("remove_fillers", "Cut filler words (eh, hmm...) and long pauses from clips, using the transcript.", BuangFillerArgs, buang_filler),
    Tool(
        "subtitles",
        "(Re)generate subtitles for everything on the timeline, word-timed from the transcript, with misheard "
        "words fixed and a creator-style look. Call after all cuts and after setting the aspect.",
        SubtitleArgs, subtitle,
    ),
    Tool(
        "storyboard",
        "Write or revise the storyboard of a video made in code (motion graphics: launch films, explainers, promos, "
        "title cards, pitch videos) with Muse Wonder: shared style plus scenes with exact on-screen text. Set the "
        "aspect first. Works with or without footage.",
        StoryboardArgs, storyboard,
    ),
    Tool(
        "build_scenes",
        "Muse Wonder writes each storyboard scene as a Remotion component, renders it, checks frames of the render "
        "and fixes it; the scenes then go on the video track in storyboard order (footage clips stay where they are). "
        "Also rebuilds scenes with change notes. Scenes are silent: add `music` after.",
        BuildScenesArgs, build_scenes,
    ),
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
