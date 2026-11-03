"""Timeline data model: the single JSON object that the agent, the editor UI, and the renderer share.

Times are seconds. Clip `src_in`/`src_out` are positions in the source media; a clip's place on the
timeline comes from its order in `clips` (the video track is magnetic, like CapCut's main track).
Text items sit at absolute timeline times on their own track.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

Aspect = Literal["16:9", "9:16", "1:1"]

# Early projects stored a few of these values in Indonesian; they are renamed as they load.
LEGACY_NAMES = {"hitam": "dip_black", "putih": "dip_white", "bersih": "clean", "tebal": "bold", "kotak": "box"}


def _legacy(v: object) -> object:
    return LEGACY_NAMES.get(v, v) if isinstance(v, str) else v

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
    kind: Literal["video", "audio"] = "video"
    recorded_at: str | None = Field(None, description="Capture time from the file's metadata (ISO 8601), if any")
    scene_id: str | None = Field(None, description="Storyboard scene this video was rendered from (made in code, silent)")


class Grade(Model):
    """Color adjustments, all 0 = untouched. Ranges are the safe bounds the renderer accepts.

    What each field does to pixels is defined once in auteur/grade.py (and ported to the editor).
    """

    exposure: float = Field(0, ge=-2, le=2, description="Stops")
    contrast: float = Field(0, ge=-1, le=1)
    saturation: float = Field(0, ge=-1, le=1)
    temperature: float = Field(0, ge=-1, le=1, description="Negative = cooler, positive = warmer")
    tint: float = Field(0, ge=-1, le=1, description="Negative = green, positive = magenta")
    highlights: float = Field(0, ge=-1, le=1, description="Brighten (+) or recover (-) the bright end")
    shadows: float = Field(0, ge=-1, le=1, description="Lift (+) or deepen (-) the dark end")
    fade: float = Field(0, ge=0, le=1, description="Lifted, matte blacks")
    shadow_hue: float = Field(200, ge=0, le=360, description="Split-toning hue for shadows (degrees)")
    shadow_tone: float = Field(0, ge=0, le=1, description="Split-toning strength for shadows")
    highlight_hue: float = Field(35, ge=0, le=360, description="Split-toning hue for highlights (degrees)")
    highlight_tone: float = Field(0, ge=0, le=1, description="Split-toning strength for highlights")
    vignette: float = Field(0, ge=0, le=1)
    log: Literal["none", "apple_log", "slog3", "vlog", "generic"] = Field(
        "none", description="Camera log profile to convert to normal contrast before grading"
    )
    look: str | None = Field(None, description="Preset this grade came from, for display")


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
    track_id: str = Field(description="Object track produced by the `track` tool")
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


class VolumeKey(Model):
    """Clip volume multiplier at a clip-local time (seconds on the timeline)."""

    t: float = Field(ge=0)
    v: float = Field(ge=0, le=2)


class Transition(Model):
    """How a clip enters from the previous one. A crossfade overlaps the two clips by `duration`;
    dips fade out to a color and back in without overlapping."""

    kind: Annotated[Literal["crossfade", "dip_black", "dip_white"], BeforeValidator(_legacy)]
    duration: float = Field(0.5, ge=0.1, le=2)


class Zoom(Model):
    """Slow push in/out over the clip (Ken Burns): scale 1 = the normal crop."""

    start: float = Field(1.0, ge=1, le=2)
    end: float = Field(1.15, ge=1, le=2)


class Clip(Model):
    id: str
    media_id: str
    src_in: float = Field(ge=0)
    src_out: float = Field(gt=0)
    speed: float = Field(1.0, ge=0.25, le=4, description="0.5 = slow motion, 2 = twice as fast; audio is muted when not 1")
    grade: Grade = Field(default_factory=Grade)
    crop: list[CropKey] = Field(default_factory=list, description="Empty = centered crop; times are clip-local timeline seconds")
    follow: Follow | None = None
    zoom: Zoom | None = None
    transition: Transition | None = Field(None, description="Transition into this clip from the previous one")
    effects: list[Effect] = Field(default_factory=list)
    muted: bool = False
    volume: float = Field(1.0, ge=0, le=2)
    volume_keys: list[VolumeKey] = Field(default_factory=list, description="Volume over time, multiplied with `volume`")

    @property
    def src_duration(self) -> float:
        return self.src_out - self.src_in

    @property
    def duration(self) -> float:
        """Length on the timeline (source length divided by speed)."""
        return self.src_duration / self.speed

    def to_source(self, local: float) -> float:
        """Clip-local timeline seconds -> source seconds."""
        return self.src_in + local * self.speed

    def to_local(self, source: float) -> float:
        """Source seconds -> clip-local timeline seconds."""
        return (source - self.src_in) / self.speed

    @property
    def has_sound(self) -> bool:
        return not self.muted and self.speed == 1 and self.volume > 0


OverlayLayout = Literal["full", "kanan_atas", "kiri_atas", "kanan_bawah", "kiri_bawah"]


class Overlay(Model):
    """A B-roll clip on the second video track, at an absolute timeline time."""

    id: str
    media_id: str
    src_in: float = Field(ge=0)
    src_out: float = Field(gt=0)
    start: float = Field(ge=0)
    layout: OverlayLayout = Field("full", description="full covers the frame; the corners are picture-in-picture")
    grade: Grade = Field(default_factory=Grade)
    muted: bool = True

    @property
    def duration(self) -> float:
        return self.src_out - self.src_in

    @property
    def end(self) -> float:
        return self.start + self.duration


class AudioItem(Model):
    """Music on the audio track, at an absolute timeline time."""

    id: str
    media_id: str
    src_in: float = Field(0, ge=0)
    src_out: float = Field(gt=0)
    start: float = Field(0, ge=0)
    volume: float = Field(0.8, ge=0, le=2)
    fade_in: float = Field(0.5, ge=0, le=10)
    fade_out: float = Field(1.5, ge=0, le=10)
    duck: bool = Field(True, description="Lower the music while someone speaks")

    @property
    def duration(self) -> float:
        return self.src_out - self.src_in


class Finish(Model):
    """Whole-video finishing touches."""

    letterbox: float | None = Field(None, ge=1.5, le=3, description="Cinema bars to this aspect ratio, e.g. 2.39")
    grain: float = Field(0, ge=0, le=1, description="Film grain amount")


TextLook = Annotated[Literal["clean", "bold", "karaoke", "box", "pop"], BeforeValidator(_legacy)]


class TextWord(Model):
    """One spoken word of a subtitle, in timeline seconds, for word-by-word looks."""

    text: str
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    emphasis: bool = False


class TextItem(Model):
    id: str
    text: str = Field(description="Line breaks (\\n) are kept as-is by both the preview and the renderer")
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    style: Literal["subtitle", "title", "caption"] = "subtitle"
    look: TextLook = Field("clean", description="clean: plain white; bold: big bold caps; karaoke: spoken word "
                           "lights up; box: spoken word in a color box; pop: words appear as they are spoken")
    color: str = Field("#FFD43B", pattern=r"^#[0-9a-fA-F]{6}$", description="Accent for highlighted/emphasized words")
    words: list[TextWord] = Field(default_factory=list)
    x: float = Field(0.5, ge=0, le=1, description="Center, normalized to output frame")
    y: float = Field(0.85, ge=0, le=1)


class Timeline(Model):
    aspect: Aspect = "16:9"
    fps: float = 30
    clips: list[Clip] = Field(default_factory=list)
    overlays: list[Overlay] = Field(default_factory=list)
    texts: list[TextItem] = Field(default_factory=list)
    audio: list[AudioItem] = Field(default_factory=list)
    finish: Finish = Field(default_factory=Finish)

    @property
    def duration(self) -> float:
        if not self.clips:
            return 0.0
        return round(self.clip_starts()[-1] + self.clips[-1].duration, 3)

    @property
    def size(self) -> tuple[int, int]:
        return ASPECT_SIZES[self.aspect]

    def clip_starts(self) -> list[float]:
        """Timeline start of each clip; a crossfade pulls a clip back over the end of the previous one."""
        starts, t = [], 0.0
        for i, c in enumerate(self.clips):
            if i and c.transition and c.transition.kind == "crossfade":
                t -= c.transition.duration
            starts.append(round(t, 3))
            t += c.duration
        return starts
