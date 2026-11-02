"""Timeline data model: the single JSON object that the agent, the editor UI, and the renderer share.

Times are seconds. Clip `src_in`/`src_out` are positions in the source media; a clip's place on the
timeline comes from its order in `clips` (the video track is magnetic, like CapCut's main track).
Text items sit at absolute timeline times on their own track.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Aspect = Literal["16:9", "9:16", "1:1"]

ASPECT_SIZES: dict[str, tuple[int, int]] = {
    "16:9": (1920, 1080),
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
}


class Model(BaseModel):
    # Defaults are always serialized, so the generated TypeScript marks them as present.
    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)


class Media(Model):
    id: str
    name: str
    path: str
    duration: float
    fps: float
    width: int
    height: int
    has_audio: bool


class Grade(Model):
    """Color adjustments, all 0 = untouched. Ranges are the safe bounds the renderer accepts."""

    exposure: float = Field(0, ge=-2, le=2, description="Stops")
    contrast: float = Field(0, ge=-1, le=1)
    saturation: float = Field(0, ge=-1, le=1)
    temperature: float = Field(0, ge=-1, le=1, description="Negative = cooler, positive = warmer")
    tint: float = Field(0, ge=-1, le=1, description="Negative = green, positive = magenta")


class CropKey(Model):
    """Crop window center at a clip-local time, normalized to the source frame (0..1)."""

    t: float = Field(ge=0)
    cx: float = Field(ge=0, le=1)
    cy: float = Field(ge=0, le=1)


class Follow(Model):
    """The tracked object a clip's crop keys follow; the checker verifies it stays in frame."""

    track_id: str
    object_id: str


class Blur(Model):
    kind: Literal["blur"] = "blur"
    track_id: str = Field(description="Object track produced by the `lacak` tool")
    object_ids: list[str] | None = Field(None, description="Objects of the track to blur; None = all")
    exclude_ids: list[str] = Field(default_factory=list, description="Objects never blurred (e.g. the main subject)")
    strength: float = Field(0.5, ge=0, le=1)
    hold: float = Field(1.0, ge=0.3, le=4, description="Seconds the blur holds across missed detections")

    def targets(self, all_ids: list[str]) -> list[str]:
        return [o for o in (self.object_ids or all_ids) if o not in self.exclude_ids]


class Highlight(Model):
    kind: Literal["highlight"] = "highlight"
    track_id: str
    object_ids: list[str] | None = Field(None, description="Objects to keep bright; None = all")
    dim_background: float = Field(0.5, ge=0, le=1)


Effect = Blur | Highlight


class Clip(Model):
    id: str
    media_id: str
    src_in: float = Field(ge=0)
    src_out: float = Field(gt=0)
    grade: Grade = Field(default_factory=Grade)
    crop: list[CropKey] = Field(default_factory=list, description="Empty = centered crop")
    follow: Follow | None = None
    effects: list[Effect] = Field(default_factory=list)
    muted: bool = False

    @property
    def duration(self) -> float:
        return self.src_out - self.src_in


class TextItem(Model):
    id: str
    text: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    style: Literal["subtitle", "title", "caption"] = "subtitle"
    x: float = Field(0.5, ge=0, le=1, description="Center, normalized to output frame")
    y: float = Field(0.85, ge=0, le=1)


class Timeline(Model):
    aspect: Aspect = "16:9"
    fps: float = 30
    clips: list[Clip] = Field(default_factory=list)
    texts: list[TextItem] = Field(default_factory=list)

    @property
    def duration(self) -> float:
        return round(sum(c.duration for c in self.clips), 3)

    @property
    def size(self) -> tuple[int, int]:
        return ASPECT_SIZES[self.aspect]

    def clip_starts(self) -> list[float]:
        starts, t = [], 0.0
        for c in self.clips:
            starts.append(round(t, 3))
            t += c.duration
        return starts
