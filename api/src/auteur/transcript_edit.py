"""Editing by transcript: the words spoken in the timeline's clips, in timeline order, and cutting the
video by deleting words (the editor's Transcript tab).

Words come from Voice Transcribe's cached transcripts (media/<id>/transcript.json, the same ones the agent
uses). Only clips whose own sound plays are listed: muted, sped-up and reversed clips say nothing.
"""

from pathlib import Path

from pydantic import BaseModel

from auteur.media import media_dir
from auteur.timeline import Project
from auteur.transcript import Transcript


class WordView(BaseModel):
    text: str
    src_start: float
    src_end: float
    start: float  # timeline seconds
    end: float
    filler: bool


class ClipWords(BaseModel):
    clip_id: str
    media_id: str
    start: float
    words: list[WordView]


class TranscriptView(BaseModel):
    clips: list[ClipWords]
    missing: list[str]  # media on the timeline with sound but no transcript yet
    missing_seconds: float


def load(project_dir: Path, media_id: str) -> Transcript | None:
    cache = media_dir(project_dir, media_id) / "transcript.json"
    return Transcript.model_validate_json(cache.read_text()) if cache.exists() else None


def view(p: Project, project_dir: Path) -> TranscriptView:
    tl = p.timeline
    clips, missing, cache = [], [], {}
    for c, start in zip(tl.clips, tl.clip_starts()):
        m = p.media.get(c.media_id)
        if not m or not m.has_audio or not c.has_sound or c.reverse:
            continue
        if c.media_id not in cache:
            cache[c.media_id] = load(project_dir, c.media_id)
        t = cache[c.media_id]
        if t is None:
            if c.media_id not in missing:
                missing.append(c.media_id)
            continue
        words = [
            WordView(
                text=w.text, src_start=w.start, src_end=w.end, filler=w.is_filler,
                start=round(start + c.to_local(max(w.start, c.src_in)), 3), end=round(start + c.to_local(min(w.end, c.src_out)), 3),
            )
            for turn in t.turns for w in turn.words
            if w.end > c.src_in + 0.02 and w.start < c.src_out - 0.02
        ]
        clips.append(ClipWords(clip_id=c.id, media_id=c.media_id, start=start, words=words))
    seconds = sum(p.media[mid].duration for mid in missing)
    return TranscriptView(clips=clips, missing=missing, missing_seconds=round(seconds, 1))


def merge(ranges: list[tuple[float, float]], gap: float = 0.05) -> list[tuple[float, float]]:
    """Adjacent deleted words become one cut (no sliver of a pause left between them)."""
    out: list[tuple[float, float]] = []
    for a, b in sorted(ranges):
        if out and a - out[-1][1] <= gap:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out
