"""The operation layer: the only way to change a timeline, used by both the agent's tools and the editor UI.

Every op is validated and applied to a copy; a failed op raises OpError with a message written for
whoever issued it (the agent reads it as a tool result and can correct itself).
"""

import re
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import Field, TypeAdapter

from auteur.timeline.models import (
    Aspect, AudioItem, Clip, CropKey, Effect, Follow, Grade, Media, Model, Overlay, OverlayLayout, TextItem,
    TextLook, TextWord, Timeline, Transition, VolumeKey, Zoom,
)

MIN_CLIP = 0.1  # seconds; shorter clips are unwatchable and break ffmpeg concat


class OpError(ValueError):
    pass


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:8]}"


class AddClip(Model):
    op: Literal["add_clip"] = "add_clip"
    id: str | None = Field(None, description="Id for the new clip; generated if omitted")
    media_id: str
    src_in: float = Field(ge=0)
    src_out: float = Field(gt=0)
    index: int | None = Field(None, description="Position in the video track; None = append")


class Split(Model):
    op: Literal["split"] = "split"
    clip_id: str
    at: float = Field(description="Timeline time to cut at")
    new_clip_id: str | None = Field(None, description="Id for the right half; generated if omitted")


class Trim(Model):
    op: Literal["trim"] = "trim"
    clip_id: str
    src_in: float | None = Field(None, ge=0)
    src_out: float | None = Field(None, gt=0)


class Move(Model):
    op: Literal["move"] = "move"
    clip_id: str
    index: int = Field(ge=0)


class Delete(Model):
    op: Literal["delete"] = "delete"
    clip_id: str


class AddText(Model):
    op: Literal["add_text"] = "add_text"
    id: str | None = None
    text: str = Field(min_length=1)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    style: Literal["subtitle", "title", "caption"] = "subtitle"
    look: TextLook = "clean"
    color: str = Field("#FFD43B", pattern=r"^#[0-9a-fA-F]{6}$")
    words: list[TextWord] = Field(default_factory=list)
    x: float = Field(0.5, ge=0, le=1)
    y: float = Field(0.85, ge=0, le=1)


class UpdateText(Model):
    op: Literal["update_text"] = "update_text"
    text_id: str
    text: str | None = Field(None, min_length=1)
    start: float | None = Field(None, ge=0)
    end: float | None = Field(None, gt=0)
    look: TextLook | None = None
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    x: float | None = Field(None, ge=0, le=1)
    y: float | None = Field(None, ge=0, le=1)


class DeleteText(Model):
    op: Literal["delete_text"] = "delete_text"
    text_id: str


class SetGrade(Model):
    op: Literal["set_grade"] = "set_grade"
    clip_ids: list[str] | None = Field(None, description="None = every clip")
    grade: Grade


class SetCrop(Model):
    op: Literal["set_crop"] = "set_crop"
    clip_id: str
    keys: list[CropKey]
    follow: Follow | None = Field(None, description="Object the keys follow (set by reframe)")


class SetEffects(Model):
    op: Literal["set_effects"] = "set_effects"
    clip_id: str
    effects: list[Effect]


class SetMuted(Model):
    op: Literal["set_muted"] = "set_muted"
    clip_id: str
    muted: bool


class SetAspect(Model):
    op: Literal["set_aspect"] = "set_aspect"
    aspect: Aspect


class SetSpeed(Model):
    op: Literal["set_speed"] = "set_speed"
    clip_id: str
    speed: float = Field(ge=0.25, le=4, description="0.5 = slow motion; the clip's source range stays the same")


class SetTransition(Model):
    op: Literal["set_transition"] = "set_transition"
    clip_id: str
    transition: Transition | None = Field(description="Into this clip from the previous one; null removes it")


class SetZoom(Model):
    op: Literal["set_zoom"] = "set_zoom"
    clip_id: str
    zoom: Zoom | None


class SetVolume(Model):
    op: Literal["set_volume"] = "set_volume"
    clip_id: str
    volume: float = Field(ge=0, le=2)


class AddOverlay(Model):
    op: Literal["add_overlay"] = "add_overlay"
    id: str | None = None
    media_id: str
    src_in: float = Field(ge=0)
    src_out: float = Field(gt=0)
    start: float = Field(ge=0, description="Timeline time the B-roll appears")
    layout: OverlayLayout = "full"


class UpdateOverlay(Model):
    op: Literal["update_overlay"] = "update_overlay"
    overlay_id: str
    src_in: float | None = Field(None, ge=0)
    src_out: float | None = Field(None, gt=0)
    start: float | None = Field(None, ge=0)
    layout: OverlayLayout | None = None
    grade: Grade | None = None


class DeleteOverlay(Model):
    op: Literal["delete_overlay"] = "delete_overlay"
    overlay_id: str


class AddAudio(Model):
    op: Literal["add_audio"] = "add_audio"
    id: str | None = None
    media_id: str
    src_in: float = Field(0, ge=0)
    src_out: float | None = Field(None, gt=0, description="Defaults to the end of the music or of the video")
    start: float = Field(0, ge=0)
    volume: float = Field(0.8, ge=0, le=2)
    fade_in: float = Field(0.5, ge=0, le=10)
    fade_out: float = Field(1.5, ge=0, le=10)
    duck: bool = True


class UpdateAudio(Model):
    op: Literal["update_audio"] = "update_audio"
    audio_id: str
    src_in: float | None = Field(None, ge=0)
    src_out: float | None = Field(None, gt=0)
    start: float | None = Field(None, ge=0)
    volume: float | None = Field(None, ge=0, le=2)
    fade_in: float | None = Field(None, ge=0, le=10)
    fade_out: float | None = Field(None, ge=0, le=10)
    duck: bool | None = None


class DeleteAudio(Model):
    op: Literal["delete_audio"] = "delete_audio"
    audio_id: str


class SetFps(Model):
    op: Literal["set_fps"] = "set_fps"
    fps: Literal[24, 25, 30, 60]


class DuplicateClip(Model):
    op: Literal["duplicate_clip"] = "duplicate_clip"
    clip_id: str
    new_clip_id: str | None = None


class SetVolumeKeys(Model):
    op: Literal["set_volume_keys"] = "set_volume_keys"
    clip_id: str
    keys: list[VolumeKey]


class SpeedRamp(Model):
    """Ease from one speed to another starting at a timeline time: the clip is cut into short steps
    with gradually changing speed, and the rest of the clip continues at `to_speed`."""

    op: Literal["speed_ramp"] = "speed_ramp"
    clip_id: str
    at: float = Field(description="Timeline time where the ramp starts")
    to_speed: float = Field(ge=0.25, le=4)
    ramp: float = Field(0.6, ge=0.2, le=3, description="Seconds (timeline) the change takes")
    steps: int = Field(5, ge=2, le=12)


class PasteClips(Model):
    op: Literal["paste_clips"] = "paste_clips"
    index: int = Field(ge=0, description="Position in the video track")
    clips: list[Clip] = Field(min_length=1, description="Copied clips; they get new ids")


class SetFinish(Model):
    op: Literal["set_finish"] = "set_finish"
    letterbox: float | None = Field(None, ge=1.5, le=3, description="Cinema bars to this ratio (2.39 = scope); null removes")
    grain: float = Field(0, ge=0, le=1)


Op = Annotated[
    AddClip | Split | Trim | Move | Delete | AddText | UpdateText | DeleteText
    | SetGrade | SetCrop | SetEffects | SetMuted | SetAspect
    | SetSpeed | SetTransition | SetZoom | SetVolume
    | AddOverlay | UpdateOverlay | DeleteOverlay | AddAudio | UpdateAudio | DeleteAudio | SetFinish
    | SetFps | DuplicateClip | SetVolumeKeys | SpeedRamp | PasteClips,
    Field(discriminator="op"),
]
op_adapter: TypeAdapter[Op] = TypeAdapter(Op)


def syllables(word: str) -> int:
    return max(1, len(re.findall(r"[aiueoy]+", word.lower())))


def spread_words(text: str, start: float, end: float, old: list[TextWord]) -> list[TextWord]:
    """Word timings for `text` over [start, end].

    When the words are unchanged and the span is unchanged the old timings are kept; otherwise the
    words are spread by syllable count over the span (an edited typo shouldn't lose its subtitle).
    """
    tokens = text.split()
    if [w.text for w in old] == tokens and old and abs(old[0].start - start) < 1e-3 and abs(old[-1].end - end) < 1e-3:
        return old
    emphasized = {w.text.lower().strip(".,!?") for w in old if w.emphasis}
    weights = [syllables(t) for t in tokens]
    total, acc, out = sum(weights) or 1, 0, []
    for tok, w in zip(tokens, weights):
        a = start + (end - start) * acc / total
        acc += w
        b = start + (end - start) * acc / total
        out.append(TextWord(text=tok, start=round(a, 3), end=round(b, 3), emphasis=tok.lower().strip(".,!?") in emphasized))
    return out


def _clip_index(tl: Timeline, clip_id: str) -> int:
    for i, c in enumerate(tl.clips):
        if c.id == clip_id:
            return i
    raise OpError(f"Clip {clip_id!r} not found; existing clips: {[c.id for c in tl.clips]}")


def _index(items: list, item_id: str, what: str) -> int:
    for i, it in enumerate(items):
        if it.id == item_id:
            return i
    raise OpError(f"{what} {item_id!r} not found; existing: {[it.id for it in items]}")


def _media(media: dict[str, Media], media_id: str, kind: str | None = None) -> Media:
    m = media.get(media_id)
    if m is None:
        raise OpError(f"Media {media_id!r} not found; available: {list(media)}")
    if kind and m.kind != kind:
        raise OpError(f"Media {media_id!r} is {m.kind}, not {kind}")
    return m


def _text_index(tl: Timeline, text_id: str) -> int:
    for i, t in enumerate(tl.texts):
        if t.id == text_id:
            return i
    raise OpError(f"Text {text_id!r} not found")


def _check_new_id(tl: Timeline, new: str | None) -> None:
    if new is not None and any(x.id == new for x in [*tl.clips, *tl.texts, *tl.overlays, *tl.audio]):
        raise OpError(f"Id {new!r} is already used")


def _check_range(media: Media, src_in: float, src_out: float) -> None:
    if src_out > media.duration + 1e-3:
        raise OpError(f"src_out {src_out} is past the end of {media.id!r} ({media.duration}s)")
    if src_out - src_in < MIN_CLIP:
        raise OpError(f"Clip would be {src_out - src_in:.3f}s; minimum is {MIN_CLIP}s")


def apply(tl: Timeline, op: Op, media: dict[str, Media]) -> Timeline:
    """Return a new timeline with `op` applied. `tl` is never mutated."""
    tl = tl.model_copy(deep=True)

    match op:
        case AddClip():
            _check_range(_media(media, op.media_id, "video"), op.src_in, op.src_out)
            _check_new_id(tl, op.id)
            clip = Clip(id=op.id or new_id("clip"), media_id=op.media_id, src_in=op.src_in, src_out=op.src_out)
            index = len(tl.clips) if op.index is None else min(op.index, len(tl.clips))
            tl.clips.insert(index, clip)

        case Split():
            i = _clip_index(tl, op.clip_id)
            clip = tl.clips[i]
            offset = op.at - tl.clip_starts()[i]
            if offset < MIN_CLIP or clip.duration - offset < MIN_CLIP:
                raise OpError(f"Split point {op.at}s is outside clip {clip.id!r} or too close to its edge")
            cut = round(clip.to_source(offset), 3)
            left = clip.model_copy(update={"src_out": cut})
            _check_new_id(tl, op.new_clip_id)
            # The right half starts with a plain cut; any transition stays where it was, on the left.
            right = clip.model_copy(
                deep=True, update={"id": op.new_clip_id or new_id("clip"), "src_in": cut, "transition": None}
            )
            # Crop keys are clip-local, so the right half's keys shift back by `offset`.
            left.crop = [k for k in clip.crop if k.t <= offset]
            right.crop = [k.model_copy(update={"t": round(k.t - offset, 3)}) for k in clip.crop if k.t >= offset]
            tl.clips[i : i + 1] = [left, right]

        case Trim():
            i = _clip_index(tl, op.clip_id)
            clip = tl.clips[i]
            src_in = clip.src_in if op.src_in is None else op.src_in
            src_out = clip.src_out if op.src_out is None else op.src_out
            _check_range(media[clip.media_id], src_in, src_out)
            # Crop keys are in clip-local timeline time, so source shifts are scaled by the speed.
            shift = (src_in - clip.src_in) / clip.speed
            crop = [k.model_copy(update={"t": round(k.t - shift, 3)}) for k in clip.crop]
            crop = [k for k in crop if 0 <= k.t <= (src_out - src_in) / clip.speed]
            tl.clips[i] = clip.model_copy(update={"src_in": src_in, "src_out": src_out, "crop": crop})

        case Move():
            i = _clip_index(tl, op.clip_id)
            clip = tl.clips.pop(i)
            tl.clips.insert(min(op.index, len(tl.clips)), clip)

        case Delete():
            tl.clips.pop(_clip_index(tl, op.clip_id))

        case AddText():
            if op.end <= op.start:
                raise OpError("Text end must be after start")
            _check_new_id(tl, op.id)
            tl.texts.append(TextItem(**{**op.model_dump(exclude={"op"}), "id": op.id or new_id("text")}))
            tl.texts.sort(key=lambda t: t.start)

        case UpdateText():
            i = _text_index(tl, op.text_id)
            old = tl.texts[i]
            changes = op.model_dump(exclude={"op", "text_id"}, exclude_none=True)
            item = old.model_copy(update=changes)
            if old.words and (op.text is not None or op.start is not None or op.end is not None):
                # Edited text or a moved/stretched item: re-spread the words over the new span.
                item = item.model_copy(update={"words": spread_words(item.text, item.start, item.end, old.words)})
            if item.end <= item.start:
                raise OpError("Text end must be after start")
            tl.texts[i] = item
            tl.texts.sort(key=lambda t: t.start)

        case DeleteText():
            tl.texts.pop(_text_index(tl, op.text_id))

        case SetGrade():
            ids = [c.id for c in tl.clips] if op.clip_ids is None else op.clip_ids
            for clip_id in ids:
                i = _clip_index(tl, clip_id)
                tl.clips[i] = tl.clips[i].model_copy(update={"grade": op.grade})

        case SetCrop():
            i = _clip_index(tl, op.clip_id)
            clip = tl.clips[i]
            if any(k.t > clip.duration + 1e-3 for k in op.keys):
                raise OpError(f"Crop key past the end of clip {clip.id!r} ({clip.duration}s)")
            tl.clips[i] = clip.model_copy(update={"crop": sorted(op.keys, key=lambda k: k.t), "follow": op.follow})

        case SetEffects():
            i = _clip_index(tl, op.clip_id)
            tl.clips[i] = tl.clips[i].model_copy(update={"effects": op.effects})

        case SetMuted():
            i = _clip_index(tl, op.clip_id)
            tl.clips[i] = tl.clips[i].model_copy(update={"muted": op.muted})

        case SetAspect():
            tl.aspect = op.aspect

        case SetSpeed():
            i = _clip_index(tl, op.clip_id)
            clip = tl.clips[i]
            if clip.src_duration / op.speed < MIN_CLIP:
                raise OpError(f"At {op.speed}x clip {clip.id!r} would be shorter than {MIN_CLIP}s")
            # Keep crop keys at the same source moments.
            ratio = clip.speed / op.speed
            crop = [k.model_copy(update={"t": round(k.t * ratio, 3)}) for k in clip.crop]
            tl.clips[i] = clip.model_copy(update={"speed": op.speed, "crop": crop})

        case SetTransition():
            i = _clip_index(tl, op.clip_id)
            tr = op.transition
            if tr is not None:
                if i == 0 and tr.kind == "crossfade":
                    raise OpError("The first clip has nothing to crossfade from; use 'dip_black' to fade in from black")
                limit = min(tl.clips[i].duration, tl.clips[i - 1].duration if i else tl.clips[i].duration)
                if tr.duration > limit / 2:
                    raise OpError(f"Transition of {tr.duration}s is too long for clips of {limit:.2f}s (max half)")
            tl.clips[i] = tl.clips[i].model_copy(update={"transition": tr})

        case SetZoom():
            i = _clip_index(tl, op.clip_id)
            tl.clips[i] = tl.clips[i].model_copy(update={"zoom": op.zoom})

        case SetVolume():
            i = _clip_index(tl, op.clip_id)
            tl.clips[i] = tl.clips[i].model_copy(update={"volume": op.volume})

        case AddOverlay():
            m = _media(media, op.media_id, "video")
            _check_range(m, op.src_in, op.src_out)
            _check_new_id(tl, op.id)
            tl.overlays.append(Overlay(**{**op.model_dump(exclude={"op"}), "id": op.id or new_id("broll")}))
            tl.overlays.sort(key=lambda o: o.start)

        case UpdateOverlay():
            i = _index(tl.overlays, op.overlay_id, "B-roll")
            item = tl.overlays[i].model_copy(update=op.model_dump(exclude={"op", "overlay_id"}, exclude_none=True))
            _check_range(media[item.media_id], item.src_in, item.src_out)
            tl.overlays[i] = item
            tl.overlays.sort(key=lambda o: o.start)

        case DeleteOverlay():
            tl.overlays.pop(_index(tl.overlays, op.overlay_id, "B-roll"))

        case AddAudio():
            m = _media(media, op.media_id)
            if not m.has_audio:
                raise OpError(f"Media {m.id!r} has no audio")
            src_out = op.src_out if op.src_out is not None else min(m.duration, op.src_in + max(tl.duration - op.start, MIN_CLIP))
            _check_range(m, op.src_in, src_out)
            _check_new_id(tl, op.id)
            tl.audio.append(AudioItem(**{**op.model_dump(exclude={"op"}), "src_out": round(src_out, 3), "id": op.id or new_id("music")}))

        case UpdateAudio():
            i = _index(tl.audio, op.audio_id, "Music")
            item = tl.audio[i].model_copy(update=op.model_dump(exclude={"op", "audio_id"}, exclude_none=True))
            _check_range(media[item.media_id], item.src_in, item.src_out)
            tl.audio[i] = item

        case DeleteAudio():
            tl.audio.pop(_index(tl.audio, op.audio_id, "Music"))

        case SetFps():
            tl.fps = op.fps

        case DuplicateClip():
            i = _clip_index(tl, op.clip_id)
            _check_new_id(tl, op.new_clip_id)
            # The copy goes right after the original and starts with a plain cut.
            tl.clips.insert(i + 1, tl.clips[i].model_copy(
                deep=True, update={"id": op.new_clip_id or new_id("clip"), "transition": None}
            ))

        case SetVolumeKeys():
            i = _clip_index(tl, op.clip_id)
            clip = tl.clips[i]
            if any(k.t > clip.duration + 1e-3 for k in op.keys):
                raise OpError(f"Volume key past the end of clip {clip.id!r} ({clip.duration:.2f}s)")
            tl.clips[i] = clip.model_copy(update={"volume_keys": sorted(op.keys, key=lambda k: k.t)})

        case SpeedRamp():
            i = _clip_index(tl, op.clip_id)
            clip = tl.clips[i]
            offset = op.at - tl.clip_starts()[i]
            if offset < 0 or offset > clip.duration - MIN_CLIP:
                raise OpError(f"Ramp start {op.at}s is outside clip {clip.id!r}")
            src = clip.to_source(offset)
            pieces = []
            if offset >= MIN_CLIP:
                pieces.append(clip.model_copy(update={
                    "src_out": round(src, 3),
                    "crop": [k for k in clip.crop if k.t <= offset],
                    "volume_keys": [k for k in clip.volume_keys if k.t <= offset],
                }))
            step_t = op.ramp / op.steps
            for k in range(1, op.steps + 1):
                speed = round(clip.speed + (op.to_speed - clip.speed) * k / op.steps, 3)
                end = min(src + step_t * speed, clip.src_out)
                if end - src < 0.02:
                    break
                pieces.append(clip.model_copy(deep=True, update={
                    "id": new_id("clip"), "src_in": round(src, 3), "src_out": round(end, 3), "speed": speed,
                    "crop": [], "transition": None, "volume_keys": [],
                }))
                src = end
            if clip.src_out - src >= MIN_CLIP * op.to_speed:
                pieces.append(clip.model_copy(deep=True, update={
                    "id": new_id("clip"), "src_in": round(src, 3), "speed": op.to_speed, "crop": [],
                    "transition": None, "volume_keys": [],
                }))
            if not offset >= MIN_CLIP:
                pieces[0] = pieces[0].model_copy(update={"id": clip.id, "transition": clip.transition})
            tl.clips[i : i + 1] = pieces

        case PasteClips():
            for c in op.clips:
                _check_range(_media(media, c.media_id, "video"), c.src_in, c.src_out)
            copies = [c.model_copy(deep=True, update={"id": new_id("clip"), "transition": None if k == 0 else c.transition})
                      for k, c in enumerate(op.clips)]
            index = min(op.index, len(tl.clips))
            tl.clips[index:index] = copies

        case SetFinish():
            tl.finish = tl.finish.model_copy(update={"letterbox": op.letterbox, "grain": op.grain})

    return tl
