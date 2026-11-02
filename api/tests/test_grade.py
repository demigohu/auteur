import subprocess

import numpy as np

from auteur import colorist
from auteur import grade as G
from auteur.timeline.models import Grade


def test_neutral_grade_is_identity() -> None:
    rgb = np.random.default_rng(0).random((8, 8, 3)).astype(np.float32)
    assert G.is_identity(Grade())
    assert np.abs(G.apply(Grade(), rgb) - rgb).max() < 1 / 255


def test_full_desaturation_is_gray_and_curves_are_monotonic() -> None:
    rgb = np.random.default_rng(1).random((8, 8, 3)).astype(np.float32)
    out = G.apply(Grade(saturation=-1), rgb)
    assert np.abs(out[..., 0] - out[..., 1]).max() < 1e-5
    table = G.lut(Grade(contrast=0.8, shadows=0.5, highlights=-0.5, fade=0.3))
    assert (np.diff(table, axis=0) >= -1e-6).all()


def test_looks_combine_within_bounds() -> None:
    base = Grade(exposure=1.9, temperature=0.9)
    for look in colorist.LOOKS:
        g = colorist.combine(base, look, 1.0, {"exposure": 1.0})
        assert -2 <= g.exposure <= 2 and -1 <= g.temperature <= 1
        assert g.look == look


def test_auto_correct_brightens_dark_footage_without_clipping() -> None:
    dark = np.full((4, 32, 32, 3), 0.1, dtype=np.float32)
    dark[:, :4, :4] = 0.9  # bright lights on 1.6% of the frame (tinier specks may clip by design)
    g = colorist.auto_correct(G.stats(dark))
    after = G.stats(G.apply(g, dark))
    assert after["luma"] > 0.11 and after["clipped"] == 0


def test_cube_file_is_accepted_by_ffmpeg(tmp_path) -> None:
    cube = G.write_cube(Grade(contrast=0.4, temperature=0.3), tmp_path / "g.cube")
    filters = ",".join(G.ffmpeg_filters(Grade(contrast=0.4, temperature=0.3), cube))
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=64x64:duration=0.1",
         "-vf", filters, "-f", "null", "-"],
        check=True,
    )
