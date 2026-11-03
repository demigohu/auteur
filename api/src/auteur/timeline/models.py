"""Timeline data model: the single JSON object that the agent, the editor UI, and the renderer share.

Times are seconds. Clip `src_in`/`src_out` are positions in the source media; a clip's place on the
timeline comes from its order in `clips` (the video track is magnetic, like CapCut's main track).
Text items sit at absolute timeline times on their own track.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

Aspect = Literal["16:9", "9:16", "1:1", "4:5"]

# Early projects stored a few of these values in Indonesian; they are renamed as they load.
LEGACY_NAMES = {"hitam": "dip_black", "putih": "dip_white", "bersih": "clean", "tebal": "bold", "kotak": "box"}


def _legacy(v: object) -> object:
    return LEGACY_NAMES.get(v, v) if isinstance(v, str) else v

ASPECT_SIZES: dict[str, tuple[int, int]] = {
    "16:9": (1920, 1080),
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
    "4:5": (1080, 1350),
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
    image: Literal["still", "gif"] | None = Field(
        None, description="Made from an uploaded picture: a still held as a silent 60s video, or a GIF looped to at least 5s"
    )


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


TransitionKind = Literal[
    "crossfade", "dip_black", "dip_white", "slide_left", "slide_right", "slide_up", "slide_down",
    "wipe_left", "wipe_right", "circle", "zoom",
]
DIPS = ("dip_black", "dip_white")


class Transition(Model):
    """How a clip enters from the previous one. Dips fade out to a color and back in without
    overlapping; every other kind overlaps the two clips by `duration` (ffmpeg xfade)."""

    kind: Annotated[TransitionKind, BeforeValidator(_legacy)] = Field(
        description="crossfade blends; slide_* pushes the old clip out; wipe_* reveals the new one with a moving edge; "
        "circle opens from the center; zoom zooms into the old clip and fades to the new; dip_* dip through a color"
    )
    duration: float = Field(0.5, ge=0.1, le=2)

    @property
    def overlaps(self) -> bool:
        return self.kind not in DIPS


class Zoom(Model):
    """Slow push in/out over the clip (Ken Burns): scale 1 = the normal crop."""

    start: float = Field(1.0, ge=1, le=2)
    end: float = Field(1.15, ge=1, le=2)


class CropRect(Model):
    """Edges cut off the source before it fills the frame, as fractions of its width and height."""

    left: float = Field(0, ge=0, le=0.9)
    right: float = Field(0, ge=0, le=0.9)
    top: float = Field(0, ge=0, le=0.9)
    bottom: float = Field(0, ge=0, le=0.9)

    def window(self, w: int, h: int) -> tuple[int, int, int, int]:
        """x, y, width, height in source pixels (even sizes, at least a tenth of the source)."""
        x, y = round(w * self.left), round(h * self.top)
        cw = max(round(w * (1 - self.left - self.right)), w // 10)
        ch = max(round(h * (1 - self.top - self.bottom)), h // 10)
        return x, y, cw - cw % 2, ch - ch % 2


class ClipLut(Model):
    """A LUT uploaded to the project (.cube), applied before the grade."""

    lut_id: str
    intensity: float = Field(1, ge=0, le=1)


class Backdrop(Model):
    """What fills the frame around a clip shown whole (fit): the clip itself, filled and blurred, or a color."""

    kind: Literal["blur", "color"] = "blur"
    color: str = Field("#000000", pattern=r"^#[0-9a-fA-F]{6}$")
    blur: float = Field(0.04, ge=0.005, le=0.2, description="Gaussian blur sigma as a fraction of the frame height")


class Transform(Model):
    """Where the (cropped) frame sits in the output: scaled and rotated about its center, flipped, then
    moved. Uncovered parts of the output are black. Applied after crop and zoom."""

    x: float = Field(0, ge=-1, le=1, description="Horizontal offset as a fraction of the output width (+ = right)")
    y: float = Field(0, ge=-1, le=1, description="Vertical offset as a fraction of the output height (+ = down)")
    scale: float = Field(1, ge=0.1, le=4)
    rotation: float = Field(0, ge=-180, le=180, description="Degrees, clockwise")
    opacity: float = Field(1, ge=0, le=1, description="Over black")
    flip_h: bool = False
    flip_v: bool = False

    @property
    def is_identity(self) -> bool:
        return self == Transform()


class TransformKey(Model):
    """The clip's pose at a clip-local time (timeline seconds); straight lines between keys."""

    t: float = Field(ge=0)
    x: float = Field(0, ge=-1, le=1)
    y: float = Field(0, ge=-1, le=1)
    scale: float = Field(1, ge=0.1, le=4)
    rotation: float = Field(0, ge=-360, le=360)
    opacity: float = Field(1, ge=0, le=1)


AnimKind = Literal["fade", "zoom_in", "zoom_out", "slide_left", "slide_right", "slide_up", "slide_down", "spin"]


class ClipAnim(Model):
    """An entrance or exit: zoom_in grows from small, zoom_out shrinks from big; slide_* moves that way."""

    kind: AnimKind
    duration: float = Field(0.5, ge=0.1, le=3)


class Clip(Model):
    id: str
    media_id: str
    src_in: float = Field(ge=0)
    src_out: float = Field(gt=0)
    speed: float = Field(1.0, ge=0.25, le=4, description="0.5 = slow motion, 2 = twice as fast; audio is muted when not 1")
    grade: Grade = Field(default_factory=Grade)
    crop: list[CropKey] = Field(default_factory=list, description="Empty = centered crop; times are clip-local timeline seconds")
    crop_rect: CropRect | None = Field(None, description="Edges of the source cut off before it fills the frame")
    fit: Literal["fill", "fit"] = Field(
        "fill", description="fill crops to the frame; fit shows the whole picture over a backdrop (e.g. landscape in 9:16)"
    )
    backdrop: Backdrop = Field(default_factory=Backdrop, description="Behind a clip shown with fit")
    follow: Follow | None = None
    zoom: Zoom | None = None
    transform: Transform | None = Field(None, description="Position, scale, rotation and flip in the frame; None = fill the frame")
    transform_keys: list[TransformKey] = Field(
        default_factory=list, description="Animated position/scale/rotation/opacity; overrides those of `transform` (flips stay)"
    )
    anim_in: ClipAnim | None = None
    anim_out: ClipAnim | None = None
    transition: Transition | None = Field(None, description="Transition into this clip from the previous one")
    effects: list[Effect] = Field(default_factory=list)
    muted: bool = False
    volume: float = Field(1.0, ge=0, le=2)
    volume_keys: list[VolumeKey] = Field(default_factory=list, description="Volume over time, multiplied with `volume`")
    reverse: bool = Field(False, description="Play the clip backwards (sound too)")
    lut: ClipLut | None = None
    audio_fade_in: float = Field(0, ge=0, le=10, description="Seconds the clip's sound fades in")
    audio_fade_out: float = Field(0, ge=0, le=10, description="Seconds the clip's sound fades out")

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


BlendMode = Literal["normal", "screen", "multiply", "overlay", "lighten", "darken", "add"]


class OverlayBox(Model):
    """A B-roll picture placed freely: its center, and its size as a fraction of the frame (same shape)."""

    x: float = Field(0.5, ge=-0.5, le=1.5, description="Center, as a fraction of the output width")
    y: float = Field(0.5, ge=-0.5, le=1.5, description="Center, as a fraction of the output height")
    scale: float = Field(0.34, ge=0.05, le=1.5, description="Width and height as a fraction of the frame's")


class Overlay(Model):
    """A B-roll clip on the second video track, at an absolute timeline time."""

    id: str
    media_id: str
    src_in: float = Field(ge=0)
    src_out: float = Field(gt=0)
    start: float = Field(ge=0)
    layout: OverlayLayout = Field("full", description="full covers the frame; the corners are picture-in-picture")
    box: OverlayBox | None = Field(None, description="Free position and size; overrides `layout` when set")
    opacity: float = Field(1, ge=0, le=1)
    blend: BlendMode = Field("normal", description="How the B-roll mixes with the picture under it")
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


class TextAnim(Model):
    """How a text enters or leaves: fade, pop (grows in), slide_up (rises in), words (one word at a time)."""

    kind: Literal["fade", "pop", "slide_up", "words"]
    duration: float = Field(0.4, ge=0.1, le=3)


TextFont = Literal["montserrat", "anton", "bebas", "poppins", "dmserif", "instrument", "marker", "mono"]

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
    font: TextFont = Field("montserrat", description="anton/bebas: condensed caps; poppins: round sans; dmserif/instrument: serif; marker: hand-drawn; mono: typewriter")
    text_color: str = Field("#FFFFFF", pattern=r"^#[0-9a-fA-F]{6}$")
    size: float | None = Field(None, ge=0.02, le=0.3, description="Font size as a fraction of the frame height; null = the look's")
    outline: float | None = Field(None, ge=0, le=0.3, description="Outline width as a fraction of the font size; null = the look's")
    outline_color: str = Field("#000000", pattern=r"^#[0-9a-fA-F]{6}$")
    shadow: bool | None = Field(None, description="Drop shadow; null = the look's")
    background: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$", description="Box behind the text")
    background_opacity: float = Field(0.65, ge=0, le=1)
    anim_in: TextAnim | None = None
    anim_out: TextAnim | None = None


class Timeline(Model):
    aspect: Aspect = "16:9"
    fps: float = 30
    clips: list[Clip] = Field(default_factory=list)
    overlays: list[Overlay] = Field(default_factory=list)
    texts: list[TextItem] = Field(default_factory=list)
    audio: list[AudioItem] = Field(default_factory=list)
    finish: Finish = Field(default_factory=Finish)
    linkage: bool = Field(
        True, description="Text and B-roll move with the main-track clip they start on (music stays put)"
    )

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
            if i and c.transition and c.transition.overlaps:
                t -= c.transition.duration
            starts.append(round(t, 3))
            t += c.duration
        return starts
