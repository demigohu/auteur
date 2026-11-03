"""Clip transforms in the export: the same flip -> scale -> rotate -> move as the preview's CSS."""

import subprocess
from pathlib import Path

import numpy as np
import pytest

from auteur.render import render
from auteur.timeline import Media, Timeline
from auteur.timeline.models import Clip, Transform

W, H = 320, 180  # the 1920x1080 timeline rendered at scale 1/6


@pytest.fixture(scope="module")
def halves(tmp_path_factory: pytest.TempPathFactory) -> Media:
    """Left half red, right half blue."""
    out = tmp_path_factory.mktemp("transform") / "halves.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=red:s={W}x{H}:r=30:d=1",
        "-vf", f"drawbox=x={W // 2}:y=0:w={W // 2}:h={H}:color=blue:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out),
    ], check=True)
    return Media(id="m", name="halves", path=str(out), duration=1, fps=30, width=W, height=H, has_audio=False)


def frame(media: Media, transform: Transform | None, tmp_path: Path) -> np.ndarray:
    tl = Timeline(clips=[Clip(id="c", media_id="m", src_in=0, src_out=1, transform=transform)])
    out = render(tl, {"m": media}, tmp_path / "out.mp4", scale=1 / 6)
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", "0.5", "-i", str(out), "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(H, W, 3).astype(int)


def color(px: np.ndarray) -> str:
    r, g, b = px
    if max(r, g, b) < 40:
        return "black"
    return "red" if r > b else "blue"


def test_no_transform_fills_the_frame(halves: Media, tmp_path: Path) -> None:
    f = frame(halves, None, tmp_path)
    assert (color(f[90, 40]), color(f[90, 280])) == ("red", "blue")


def test_flip_mirrors(halves: Media, tmp_path: Path) -> None:
    f = frame(halves, Transform(flip_h=True), tmp_path)
    assert (color(f[90, 40]), color(f[90, 280])) == ("blue", "red")


def test_scale_down_leaves_black_around_the_centered_frame(halves: Media, tmp_path: Path) -> None:
    f = frame(halves, Transform(scale=0.5), tmp_path)
    assert color(f[10, 10]) == "black" and color(f[170, 310]) == "black"
    assert (color(f[90, 100]), color(f[90, 220])) == ("red", "blue")  # the frame spans x 80..240


def test_move_right_uncovers_the_left(halves: Media, tmp_path: Path) -> None:
    f = frame(halves, Transform(x=0.5), tmp_path)
    assert color(f[90, 40]) == "black"  # x 0..160 uncovered
    assert (color(f[90, 200]), color(f[90, 300])) == ("red", "red")  # the red half now sits at 160..320


def test_rotate_half_turn_swaps_sides(halves: Media, tmp_path: Path) -> None:
    f = frame(halves, Transform(rotation=180), tmp_path)
    assert (color(f[90, 40]), color(f[90, 280])) == ("blue", "red")


def test_quarter_turn_is_clockwise(halves: Media, tmp_path: Path) -> None:
    # Clockwise: the left (red) half ends up on top, as CSS rotate(90deg) draws it. A 16:9 frame turned
    # upright is only 180px wide, so the sides are black.
    f = frame(halves, Transform(rotation=90), tmp_path)
    assert (color(f[45, 160]), color(f[135, 160])) == ("red", "blue")
    assert color(f[90, 10]) == "black"


def test_free_broll_box_lands_where_the_preview_puts_it(halves: Media, tmp_path: Path) -> None:
    from auteur.timeline.models import Overlay, OverlayBox

    # A half-size copy centered at 75% across: its red half covers x 160..240, over the base's blue half.
    tl = Timeline(
        clips=[Clip(id="c", media_id="m", src_in=0, src_out=1)],
        overlays=[Overlay(id="o", media_id="m", src_in=0, src_out=1, start=0, box=OverlayBox(x=0.75, y=0.5, scale=0.5))],
    )
    out = render(tl, {"m": halves}, tmp_path / "out.mp4", scale=1 / 6)
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", "0.5", "-i", str(out), "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(H, W, 3).astype(int)
    assert (color(f[90, 200]), color(f[90, 280]), color(f[20, 200])) == ("red", "blue", "blue")


def test_picking_a_preset_clears_a_dragged_box() -> None:
    from auteur.timeline.models import Overlay, OverlayBox
    from auteur.timeline.ops import UpdateOverlay, apply

    media = {"m": Media(id="m", name="m", path="m.mp4", duration=5, fps=30, width=W, height=H, has_audio=False)}
    tl = Timeline(overlays=[Overlay(id="o", media_id="m", src_in=0, src_out=1, start=0)])
    tl = apply(tl, UpdateOverlay(overlay_id="o", box=OverlayBox(x=0.2, y=0.2, scale=0.3)), media)
    assert tl.overlays[0].box is not None
    tl = apply(tl, UpdateOverlay(overlay_id="o", start=0.5), media)
    assert tl.overlays[0].box is not None  # other edits keep it
    tl = apply(tl, UpdateOverlay(overlay_id="o", layout="kiri_atas"), media)
    assert tl.overlays[0].box is None and tl.overlays[0].layout == "kiri_atas"


def test_cropping_the_right_half_leaves_only_red(halves: Media, tmp_path: Path) -> None:
    from auteur.timeline.models import CropRect

    tl = Timeline(clips=[Clip(id="c", media_id="m", src_in=0, src_out=1, crop_rect=CropRect(right=0.5))])
    out = render(tl, {"m": halves}, tmp_path / "out.mp4", scale=1 / 6)
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", "0.5", "-i", str(out), "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(H, W, 3).astype(int)
    # The red half (160x180) fills the 16:9 frame: everything is red.
    assert {color(f[90, x]) for x in (10, 160, 310)} == {"red"}


def test_crop_keys_pan_inside_the_cropped_area() -> None:
    from auteur.render import cut_edges
    from auteur.timeline.models import CropKey, CropRect

    m = Media(id="m", name="m", path="m.mp4", duration=1, fps=30, width=1000, height=500, has_audio=False)
    f, inner, keys = cut_edges(m, CropRect(left=0.2, right=0.2), [CropKey(t=0, cx=0.5, cy=0.5), CropKey(t=1, cx=0.1, cy=0.5)])
    assert f == "crop=600:500:200:0" and (inner.width, inner.height) == (600, 500)
    assert [(k.cx, k.cy) for k in keys] == [(0.5, 0.5), (0, 0.5)]  # 0.1 of the source is cut away: clamped to the edge


def test_crop_rect_op_refuses_cropping_almost_everything() -> None:
    import pytest as pt

    from auteur.timeline import OpError
    from auteur.timeline.models import CropRect
    from auteur.timeline.ops import SetCropRect, apply

    tl = Timeline(clips=[Clip(id="c", media_id="m", src_in=0, src_out=1)])
    media = {"m": Media(id="m", name="m", path="m.mp4", duration=1, fps=30, width=W, height=H, has_audio=False)}
    with pt.raises(OpError):
        apply(tl, SetCropRect(clip_id="c", crop_rect=CropRect(left=0.5, right=0.45)), media)
    assert apply(tl, SetCropRect(clip_id="c", crop_rect=CropRect()), media).clips[0].crop_rect is None


@pytest.fixture(scope="module")
def greens(tmp_path_factory: pytest.TempPathFactory) -> Media:
    """Left half green, right half yellow: the clip a transition goes into."""
    out = tmp_path_factory.mktemp("transform") / "greens.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=green:s={W}x{H}:r=30:d=2",
        "-vf", f"drawbox=x={W // 2}:y=0:w={W // 2}:h={H}:color=yellow:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out),
    ], check=True)
    return Media(id="g", name="greens", path=str(out), duration=2, fps=30, width=W, height=H, has_audio=False)


def named(px: np.ndarray) -> str:
    r, g, b = px
    if r > 150 and g > 150 and b < 100:
        return "yellow"
    if g > 100 and r < 100 and b < 100:
        return "green"
    return color(px)


# A quarter of the way through each transition; lib/transitions.ts draws the same (transitions.test.ts).
@pytest.mark.parametrize("kind, samples", [
    ("slide_left", {40: "red", 160: "blue", 280: "green"}),      # both move left; the new clip at 0.75 W
    ("slide_right", {40: "yellow", 120: "red", 280: "blue"}),    # both move right
    ("wipe_left", {40: "red", 200: "blue", 280: "yellow"}),      # the new clip shows at x > 0.75 W, in place
    ("wipe_right", {40: "green", 120: "red", 280: "blue"}),      # the new clip shows at x < 0.25 W
])
def test_xfade_transitions_quarter_way(kind: str, samples: dict[int, str], halves: Media, greens: Media, tmp_path: Path) -> None:
    from auteur.timeline.models import Transition

    tl = Timeline(clips=[
        Clip(id="a", media_id="m", src_in=0, src_out=1),
        Clip(id="b", media_id="g", src_in=0, src_out=1, transition=Transition(kind=kind, duration=0.8)),
    ])
    out = render(tl, {"m": halves, "g": greens}, tmp_path / "out.mp4", scale=1 / 6)
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{0.2 + 0.8 * 0.25:.3f}", "-i", str(out), "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(H, W, 3).astype(int)
    assert {x: named(f[90, x]) for x in samples} == samples


def test_fit_shows_the_whole_picture_over_a_backdrop(halves: Media, tmp_path: Path) -> None:
    from auteur.timeline.models import Backdrop

    # A 16:9 picture in a square frame: fitted it spans the full width at 9/16 of the height.
    tl = Timeline(aspect="1:1", clips=[Clip(id="c", media_id="m", src_in=0, src_out=1, fit="fit",
                                            backdrop=Backdrop(kind="color", color="#00FF00"))])
    out = render(tl, {"m": halves}, tmp_path / "out.mp4", scale=1 / 6)  # 180 x 180
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", "0.5", "-i", str(out), "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(180, 180, 3).astype(int)
    green = lambda px: px[1] > 150 and px[0] < 100 and px[2] < 100  # noqa: E731
    assert green(f[10, 90]) and green(f[170, 90])  # above and below the picture
    assert (color(f[90, 20]), color(f[90, 160])) == ("red", "blue")  # both halves visible: nothing cropped


def test_fit_with_a_blurred_backdrop_and_zoom_renders(halves: Media, tmp_path: Path) -> None:
    from auteur.timeline.models import Zoom

    tl = Timeline(aspect="9:16", clips=[Clip(id="c", media_id="m", src_in=0, src_out=1, fit="fit", zoom=Zoom(start=1, end=1.2))])
    out = render(tl, {"m": halves}, tmp_path / "out.mp4", scale=1 / 6)
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", "0.1", "-i", str(out), "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(320, 180, 3).astype(int)
    assert color(f[10, 20]) == "red" and color(f[310, 160]) == "blue"  # the blurred fill reaches the corners


def test_detached_sound_still_plays_in_the_export(tmp_path: Path, sample_video: Path) -> None:
    from auteur.media import probe
    from auteur.timeline.ops import AddClip, DetachAudio, SetAudioFade, apply

    m = Media(id="v", name="v", path=str(sample_video), **{k: v for k, v in probe(sample_video).items() if k != "recorded_at"})
    media = {"v": m}
    tl = Timeline()
    for op in (AddClip(id="c", media_id="v", src_in=0, src_out=3), SetAudioFade(clip_id="c", fade_in=0.5, fade_out=0.5),
               DetachAudio(clip_id="c")):
        tl = apply(tl, op, media)
    out = render(tl, media, tmp_path / "out.mp4", scale=1 / 6)
    stats = subprocess.run(["ffmpeg", "-i", str(out), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True).stderr
    peak = float(stats.split("max_volume:")[1].split("dB")[0])
    assert peak > -30, stats[-300:]  # the 440 Hz tone is there, now from the music track


def rgb_at(out: Path, t: float, x: int, y: int, w: int = W, h: int = H) -> tuple[int, int, int]:
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", str(out), "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return tuple(np.frombuffer(raw, np.uint8).reshape(h, w, 3)[y, x].astype(int))


@pytest.mark.parametrize("blend, opacity, expect", [
    ("normal", 0.5, lambda p: 90 < p[0] < 170 and 40 < p[1] < 110),   # red under half-transparent green
    ("multiply", 1.0, lambda p: max(p) < 40),                          # red x green = black
    ("screen", 1.0, lambda p: p[0] > 200 and p[1] > 100 and p[2] < 90),  # red screen green = yellowish
    ("add", 1.0, lambda p: p[0] > 200 and p[1] > 100),
    ("darken", 1.0, lambda p: max(p) < 40),
])
def test_broll_opacity_and_blend(blend: str, opacity: float, expect, halves: Media, greens: Media, tmp_path: Path) -> None:
    from auteur.timeline.models import Overlay

    tl = Timeline(
        clips=[Clip(id="c", media_id="m", src_in=0, src_out=1)],
        overlays=[Overlay(id="o", media_id="g", src_in=0, src_out=0.5, start=0.3, opacity=opacity, blend=blend)],
    )
    out = render(tl, {"m": halves, "g": greens}, tmp_path / "out.mp4", scale=1 / 6)
    assert color(np.array(rgb_at(out, 0.1, 40, 90))) == "red"  # before the B-roll: untouched
    assert expect(rgb_at(out, 0.55, 40, 90)), rgb_at(out, 0.55, 40, 90)  # red base under the green half
    assert color(np.array(rgb_at(out, 0.95, 40, 90))) == "red"  # after it: untouched again


def frame_at(media: Media, clip: Clip, t: float, tmp_path: Path) -> np.ndarray:
    out = render(Timeline(clips=[clip]), {"m": media}, tmp_path / "anim.mp4", scale=1 / 6)
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", str(out), "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(H, W, 3).astype(int)


def test_position_keyframes_move_the_clip_over_time(halves: Media, tmp_path: Path) -> None:
    from auteur.timeline.models import TransformKey

    clip = Clip(id="c", media_id="m", src_in=0, src_out=1,
                transform_keys=[TransformKey(t=0, x=0), TransformKey(t=1, x=0.5)])
    assert color(frame_at(halves, clip, 0.02, tmp_path)[90, 40]) == "red"  # not moved yet
    mid = frame_at(halves, clip, 0.5, tmp_path)  # moved a quarter of the width: x < 80 uncovered
    assert (color(mid[90, 40]), color(mid[90, 120]), color(mid[90, 260])) == ("black", "red", "blue")


def test_rotation_and_scale_keyframes(halves: Media, tmp_path: Path) -> None:
    from auteur.timeline.models import TransformKey

    clip = Clip(id="c", media_id="m", src_in=0, src_out=1,
                transform_keys=[TransformKey(t=0, rotation=0, scale=1), TransformKey(t=0.9, rotation=180, scale=0.5)])
    end = frame_at(halves, clip, 0.95, tmp_path)  # half size and turned around: blue now on the left
    assert color(end[10, 10]) == "black"
    assert (color(end[90, 110]), color(end[90, 210])) == ("blue", "red")


def test_fade_in_animation(halves: Media, tmp_path: Path) -> None:
    from auteur.timeline.models import ClipAnim

    clip = Clip(id="c", media_id="m", src_in=0, src_out=1, anim_in=ClipAnim(kind="fade", duration=0.5))
    early, late = frame_at(halves, clip, 0.03, tmp_path)[90, 40], frame_at(halves, clip, 0.8, tmp_path)[90, 40]
    assert early[0] < 120 and late[0] > 200  # red comes up out of black


def test_slide_out_animation_leaves_to_the_left(halves: Media, tmp_path: Path) -> None:
    from auteur.timeline.models import ClipAnim

    clip = Clip(id="c", media_id="m", src_in=0, src_out=1, anim_out=ClipAnim(kind="slide_left", duration=0.5))
    f = frame_at(halves, clip, 0.93, tmp_path)  # most of the way out: the right side is uncovered
    assert color(f[90, 300]) == "black" and color(f[90, 10]) in ("red", "blue")
