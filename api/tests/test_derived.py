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
