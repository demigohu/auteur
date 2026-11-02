from auteur.reframe import follow_keys, out_of_frame
from auteur.timeline.models import Clip, Media
from auteur.tracking import Track, stitch

MEDIA = Media(id="m", name="m", path="m.mp4", duration=10, fps=30, width=1920, height=1080, has_audio=True)


def moving_track(speed_px_per_frame: int) -> Track:
    """One person walking left to right across a 640x360 proxy at 15fps for 10s."""
    frames = {f: (min(20 + f * speed_px_per_frame, 560), 60, min(80 + f * speed_px_per_frame, 620), 340) for f in range(150)}
    return Track(id="t", media_id="m", prompt="person", fps=15, width=640, height=360, total_frames=150, objects={"0": frames})


def test_stitch_links_object_across_segments() -> None:
    seg0 = {"3": {148: (100, 100, 200, 300), 149: (102, 100, 202, 300)}, "7": {10: (0, 0, 10, 10)}}
    seg1 = {"0": {0: (104, 100, 204, 300), 1: (106, 100, 206, 300)}, "1": {0: (500, 0, 600, 100)}}
    merged = stitch([seg0, seg1], frames_per_segment=150)
    walker = next(oid for oid, f in merged.items() if 148 in f)
    assert {148, 149, 150, 151} <= set(merged[walker])  # same global id on both sides
    assert len(merged) == 3


def test_reframe_follows_and_checker_catches_lag() -> None:
    track = moving_track(speed_px_per_frame=4)
    clip = Clip(id="c", media_id="m", src_in=0, src_out=10)

    tight = clip.model_copy(update={"crop": follow_keys(track, "0", clip, smooth_seconds=0.3)})
    assert tight.crop[0].cx < 0.2 and tight.crop[-1].cx > 0.8
    assert out_of_frame(track, "0", tight, MEDIA, 1080, 1920) == []

    # A static center crop loses a subject that walks to the edge.
    centered = clip.model_copy(update={"crop": []})
    assert out_of_frame(track, "0", centered, MEDIA, 1080, 1920)
