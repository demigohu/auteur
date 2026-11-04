"""Reversed clips and LUTs: the derived files, the export, and the API."""

import subprocess
from pathlib import Path

import numpy as np
import pytest

from auteur import derived
from auteur.render import render
from auteur.timeline import Media, Timeline
from auteur.timeline.models import Clip, ClipLut

W, H = 64, 36


@pytest.fixture(scope="module")
def ramp(tmp_path_factory: pytest.TempPathFactory) -> Media:
    """5s where the brightness rises with time (frame n has luma ~ n), in a <project>/media/<id>/ layout."""
    d = tmp_path_factory.mktemp("proj") / "media" / "m"
    d.mkdir(parents=True)
    out = d / "source.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=black:s={W}x{H}:r=30:d=5",
                    "-vf", "geq=lum='min(255,N*1.6)':cb=128:cr=128", "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p", str(out)],
                   check=True)
    return Media(id="m", name="ramp", path=str(out), duration=5, fps=30, width=W, height=H, has_audio=False)


def luma(video: Path, t: float) -> float:
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout
    return float(np.frombuffer(raw, np.uint8).mean())


def test_reverse_file_plays_backwards_in_chunks(ramp: Media, tmp_path: Path) -> None:
    out = derived.reverse_file(Path(ramp.path), tmp_path / "rev.mp4", ramp.duration, False)
    assert luma(out, 0.2) > luma(out, 2.5) > luma(out, 4.7)  # bright first now
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)],
                               capture_output=True, text=True).stdout)
    assert dur == pytest.approx(5, abs=0.1)


def test_a_reversed_clip_exports_its_own_range_backwards(ramp: Media, tmp_path: Path) -> None:
    tl = Timeline(clips=[Clip(id="c", media_id="m", src_in=1, src_out=3, reverse=True)])
    out = render(tl, {"m": ramp}, tmp_path / "out.mp4", scale=1 / 30)
    forward = render(Timeline(clips=[Clip(id="c", media_id="m", src_in=1, src_out=3)]), {"m": ramp}, tmp_path / "f.mp4", scale=1 / 30)
    # The first frame backwards is the last frame forwards, and the other way round.
    assert luma(out, 0.05) == pytest.approx(luma(forward, 1.95), abs=4)
    assert luma(out, 1.95) == pytest.approx(luma(forward, 0.05), abs=4)


def test_lut_parsing_and_intensity(tmp_path: Path) -> None:
    ident = derived.identity(2)
    assert ident.tolist()[:3] == [[0, 0, 0], [1, 0, 0], [0, 1, 0]]  # red changes fastest
    invert = derived.write_cube(2, 1 - ident, tmp_path / "invert.cube")
    size, table = derived.parse_cube(invert.read_text())
    assert size == 2 and np.allclose(table, 1 - ident)
    half = derived.parse_cube(derived.scaled_lut(invert, 0.5, tmp_path / "half.cube").read_text())[1]
    assert np.allclose(half, 0.5)  # halfway between a color and its inverse is mid grey
    with pytest.raises(derived.DerivedError):
        derived.parse_cube("LUT_3D_SIZE 2\n0 0 0\n")


def test_a_lut_changes_the_export(ramp: Media, tmp_path: Path) -> None:
    luts = Path(ramp.path).parents[2] / "luts"
    luts.mkdir(exist_ok=True)
    derived.write_cube(2, 1 - derived.identity(2), luts / "lut_inv.cube")
    plain = render(Timeline(clips=[Clip(id="c", media_id="m", src_in=0, src_out=1)]), {"m": ramp}, tmp_path / "p.mp4", scale=1 / 30)
    full = render(Timeline(clips=[Clip(id="c", media_id="m", src_in=0, src_out=1, lut=ClipLut(lut_id="lut_inv"))]),
                  {"m": ramp}, tmp_path / "l.mp4", scale=1 / 30)
    assert luma(plain, 0.1) < 40 and luma(full, 0.1) > 200  # dark frames inverted


def test_noise_reduction_quiets_hiss_and_keeps_the_sound(tmp_path: Path) -> None:
    from auteur.timeline.models import AudioClean

    src = tmp_path / "noisy.mp4"  # a 300 Hz tone (the "voice") in white noise
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=64x36:r=30:d=3",
                    "-f", "lavfi", "-i", "anoisesrc=d=3:c=white:a=0.05", "-f", "lavfi", "-i", "sine=f=300:d=3",
                    "-filter_complex", "[2]volume=0.3[s];[1][s]amix=inputs=2:normalize=0[a]", "-map", "0:v", "-map", "[a]",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", "-shortest", str(src.with_suffix(".mov"))],
                   check=True)
    src = src.with_suffix(".mov")
    m = Media(id="n", name="noisy", path=str(src), duration=3, fps=30, width=64, height=36, has_audio=True)

    def band(out: Path, filters: str) -> float:
        err = subprocess.run(["ffmpeg", "-i", str(out), "-af", f"{filters},volumedetect", "-f", "null", "-"],
                             capture_output=True, text=True).stderr
        return float(err.split("mean_volume:")[1].split("dB")[0])

    plain = render(Timeline(clips=[Clip(id="c", media_id="n", src_in=0, src_out=3)]), {"n": m}, tmp_path / "a.mp4", scale=1 / 30)
    clean = render(Timeline(clips=[Clip(id="c", media_id="n", src_in=0, src_out=3, audio_clean=AudioClean(denoise=0.8))]),
                   {"n": m}, tmp_path / "b.mp4", scale=1 / 30)
    assert band(clean, "highpass=f=2000") < band(plain, "highpass=f=2000") - 6  # hiss down
    tone = "highpass=f=200,lowpass=f=400"
    assert abs(band(clean, tone) - band(plain, tone)) < 1.5  # the tone kept
    assert derived.audio_clean_filters(AudioClean()) == []
    assert derived.variant_name(Clip(id="c", media_id="n", src_in=0, src_out=3, audio_clean=AudioClean(voice=True))) is not None


def test_chroma_key_makes_the_screen_transparent(tmp_path: Path) -> None:
    from auteur.timeline.models import ChromaKey, Overlay

    base = tmp_path / "base.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=blue:s=320x180:r=30:d=1",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(base)], check=True)
    screen = tmp_path / "screen.mp4"  # a red box on a green screen
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=0x00FF00:s=320x180:r=30:d=1",
                    "-vf", "drawbox=x=120:y=60:w=80:h=60:color=red:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(screen)], check=True)
    media = {k: Media(id=k, name=k, path=str(p), duration=1, fps=30, width=320, height=180, has_audio=False)
             for k, p in (("b", base), ("s", screen))}
    tl = Timeline(clips=[Clip(id="c", media_id="b", src_in=0, src_out=1)],
                  overlays=[Overlay(id="o", media_id="s", src_in=0, src_out=1, start=0, chroma=ChromaKey())])
    out = render(tl, media, tmp_path / "out.mp4", scale=1 / 6)
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", "0.5", "-i", str(out), "-frames:v", "1", "-f", "rawvideo",
                          "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(180, 320, 3).astype(int)
    assert f[20, 20][2] > 150 and f[20, 20][1] < 100  # the green screen shows the blue base through
    assert f[90, 160][0] > 150 and f[90, 160][1] < 100  # the red subject stays


def test_background_removal_keeps_the_masked_subject(tmp_path: Path) -> None:
    from auteur import masks
    from auteur.timeline.models import Backdrop, BgRemove

    d = tmp_path / "proj" / "media" / "m"
    d.mkdir(parents=True)
    src = d / "source.mp4"  # red picture
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=red:s=320x180:r=30:d=1",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(src)], check=True)
    mask = d / masks.mask_name("person", "main")  # the subject: the middle third
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=160x90:r=15:d=1",
                    "-vf", "drawbox=x=53:y=0:w=54:h=90:color=white:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(mask)], check=True)
    m = Media(id="m", name="m", path=str(src), duration=1, fps=30, width=320, height=180, has_audio=False)
    clip = Clip(id="c", media_id="m", src_in=0, src_out=1,
                bg_remove=BgRemove(backdrop=Backdrop(kind="color", color="#0000FF")))
    out = render(Timeline(clips=[clip]), {"m": m}, tmp_path / "out.mp4", scale=1 / 6)
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", "0.5", "-i", str(out), "-frames:v", "1", "-f", "rawvideo",
                          "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(180, 320, 3).astype(int)
    assert f[90, 160][0] > 150 and f[90, 160][2] < 100  # the subject (red) stays
    assert f[90, 20][2] > 150 and f[90, 20][0] < 100  # the background is the blue backdrop
    # The editor's preview variant is made the same way.
    (d / "preview.mp4").write_bytes(src.read_bytes())
    variant = derived.make_variant(d, m, clip, tmp_path / "luts")
    assert variant.name == derived.preview_name(clip)  # the file the editor asks for
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", "0.5", "-i", str(variant), "-frames:v", "1", "-f", "rawvideo",
                          "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    p = np.frombuffer(raw, np.uint8).reshape(180, 320, 3).astype(int)
    assert p[90, 160][0] > 150 and p[90, 20][2] > 150
    # Next to other clips, with a crossfade into it (xfade needs both at the same timebase).
    from auteur.timeline.models import Transition

    plain = Clip(id="a", media_id="m", src_in=0, src_out=1)
    faded = clip.model_copy(update={"transition": Transition(kind="crossfade", duration=0.4)})
    out = render(Timeline(clips=[plain, faded]), {"m": m}, tmp_path / "mixed.mp4", scale=1 / 6)
    assert out.exists()
    # A grade colors the backdrop too, as in the editor (it grades the background-removed variant).
    from auteur.timeline.models import Grade

    graded = clip.model_copy(update={"grade": Grade(exposure=-1)})
    out = render(Timeline(clips=[graded]), {"m": m}, tmp_path / "graded.mp4", scale=1 / 6)
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", "0.5", "-i", str(out), "-frames:v", "1", "-f", "rawvideo",
                          "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    g = np.frombuffer(raw, np.uint8).reshape(180, 320, 3).astype(int)
    assert g[90, 20][2] < f[90, 20][2] - 40  # the blue backdrop is darker
