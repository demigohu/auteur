import numpy as np

from auteur import grade as G
from auteur import reference as R
from auteur.timeline.models import Grade


def scene(seed: int) -> np.ndarray:
    """Six small frames of smooth color fields, like footage statistics without needing a video."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:60, 0:100] / np.array([60, 100])[:, None, None]
    frames = []
    for _ in range(6):
        a, b, c = rng.uniform(0.2, 0.9, 3)
        frames.append(np.stack([a * x + 0.1 * y, b * y + 0.05, c * (1 - x) * 0.8 + 0.1], -1).astype(np.float32))
    return np.clip(np.stack(frames), 0, 1)


def test_fit_recovers_a_known_look() -> None:
    frames = scene(1)
    look = Grade(contrast=0.5, saturation=-0.3, temperature=-0.4, shadow_tone=0.8, shadow_hue=190, highlight_tone=0.7, highlight_hue=30)
    # The reference shows the same content graded, so a perfect fit exists; the search must find it.
    ref = G.apply(look, frames)
    [(_, before, after)] = R.match_clips([Grade()], [frames], ref, strength=1.0)
    assert before > 0.5
    assert after < 0.16, after


def test_strength_moves_part_of_the_way() -> None:
    frames = scene(2)
    ref = G.apply(Grade(exposure=-0.6, temperature=0.6), frames[0])
    [(full, _, after_full)] = R.match_clips([Grade()], [frames], ref, strength=1.0)
    [(half, _, after_half)] = R.match_clips([Grade()], [frames], ref, strength=0.5)
    assert after_full < after_half
    assert abs(half.temperature) < abs(full.temperature)


def test_describe_names_split_toning() -> None:
    frames = scene(3)
    teal_orange = G.apply(Grade(shadow_tone=1, shadow_hue=190, highlight_tone=1, highlight_hue=30, temperature=0.2), frames[0])
    assert "cool shadows" in R.describe(teal_orange)
