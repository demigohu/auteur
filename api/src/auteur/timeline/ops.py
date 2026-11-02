"""The operation layer: the only way to change a timeline, used by both the agent's tools and the editor UI.

Every op is validated and applied to a copy; a failed op raises OpError with a message written for
whoever issued it (the agent reads it as a tool result and can correct itself).
"""

from typing import Annotated, Literal
from uuid import uuid4

from pydantic import Field, TypeAdapter

from auteur.timeline.models import Aspect, Clip, CropKey, Effect, Follow, Grade, Media, Model, TextItem, Timeline

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
    x: float = Field(0.5, ge=0, le=1)
    y: float = Field(0.85, ge=0, le=1)


class UpdateText(Model):
    op: Literal["update_text"] = "update_text"
    text_id: str
    text: str | None = Field(None, min_length=1)
    start: float | None = Field(None, ge=0)
    end: float | None = Field(None, gt=0)
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


Op = Annotated[
    AddClip | Split | Trim | Move | Delete | AddText | UpdateText | DeleteText
    | SetGrade | SetCrop | SetEffects | SetMuted | SetAspect,
    Field(discriminator="op"),
]
op_adapter: TypeAdapter[Op] = TypeAdapter(Op)


def _clip_index(tl: Timeline, clip_id: str) -> int:
    for i, c in enumerate(tl.clips):
        if c.id == clip_id:
            return i
    raise OpError(f"Clip {clip_id!r} not found; existing clips: {[c.id for c in tl.clips]}")


def _text_index(tl: Timeline, text_id: str) -> int:
    for i, t in enumerate(tl.texts):
        if t.id == text_id:
            return i
    raise OpError(f"Text {text_id!r} not found")


def _check_new_id(tl: Timeline, new: str | None) -> None:
    if new is not None and any(x.id == new for x in [*tl.clips, *tl.texts]):
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
            if op.media_id not in media:
                raise OpError(f"Media {op.media_id!r} not found; available: {list(media)}")
            _check_range(media[op.media_id], op.src_in, op.src_out)
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
            cut = round(clip.src_in + offset, 3)
            left = clip.model_copy(update={"src_out": cut})
            _check_new_id(tl, op.new_clip_id)
            right = clip.model_copy(deep=True, update={"id": op.new_clip_id or new_id("clip"), "src_in": cut})
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
            shift = src_in - clip.src_in
            crop = [k.model_copy(update={"t": round(k.t - shift, 3)}) for k in clip.crop]
            crop = [k for k in crop if 0 <= k.t <= src_out - src_in]
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
            changes = op.model_dump(exclude={"op", "text_id"}, exclude_none=True)
            item = tl.texts[i].model_copy(update=changes)
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

    return tl
