"""Text style overrides in the export (textlayer.py); the preview mirrors them in TextLayer.tsx."""

from pathlib import Path

import pytest
from PIL import Image

from auteur import textlayer
from auteur.timeline.models import TextItem
from auteur.timeline.ops import UpdateText, apply
from auteur.timeline import Timeline


def drawn(**fields) -> Image.Image:
    img = Image.new("RGBA", (640, 360), (0, 0, 0, 0))
    item = TextItem(id="t", text="Hello", start=0, end=1, style="title", x=0.5, y=0.5, **fields)
    textlayer.draw_item(img, item, -1)
    return img


@pytest.mark.parametrize("name", list(textlayer.FONT_FILES))
def test_every_font_file_loads_and_draws(name: str) -> None:
    f = textlayer.font(400, 40, name)
    assert Path(f.path).name == textlayer.FONT_FILES[name]
    assert drawn(font=name).getbbox() is not None


def test_text_color_and_box() -> None:
    img = drawn(text_color="#111111", outline=0, shadow=False, background="#C6FF3E", background_opacity=1)
    # The box spans the text block; away from the letters it is the box color.
    left, top, right, bottom = img.getbbox()
    assert img.getpixel((left + 3, (top + bottom) // 2))[:3] == (198, 255, 62)


def test_size_and_outline_override_the_look() -> None:
    small = drawn(size=0.05, outline=0).getbbox()
    big = drawn(size=0.12, outline=0).getbbox()
    assert (big[3] - big[1]) > 2 * (small[3] - small[1])
    plain, outlined = drawn(outline=0).getbbox(), drawn(outline=0.2).getbbox()
    assert outlined[2] - outlined[0] > plain[2] - plain[0]


def test_update_text_can_clear_overrides() -> None:
    tl = Timeline(texts=[TextItem(id="t", text="Hi", start=0, end=1, size=0.1, background="#000000")])
    tl = apply(tl, UpdateText(text_id="t", font="anton"), {})
    assert (tl.texts[0].font, tl.texts[0].size, tl.texts[0].background) == ("anton", 0.1, "#000000")  # untouched
    tl = apply(tl, UpdateText(text_id="t", size=None, background=None), {})
    assert (tl.texts[0].size, tl.texts[0].background) == (None, None)
    tl = apply(tl, UpdateText(text_id="t", text_color=None), {})  # a required field ignores null
    assert tl.texts[0].text_color == "#FFFFFF"


def test_text_entrance_and_exit_states() -> None:
    from auteur.timeline.models import TextAnim

    item = TextItem(id="t", text="one two three four", start=1, end=3,
                    anim_in=TextAnim(kind="pop", duration=0.4), anim_out=TextAnim(kind="fade", duration=0.5))
    first = textlayer.text_state(item, 1.0)
    assert (first.alpha, first.scale) == (0, 0.6)
    assert textlayer.text_state(item, 1.2).scale == pytest.approx(0.6 + 0.4 * (1 - 0.5**3))
    assert textlayer.text_state(item, 2.0) == textlayer.TextState()  # in between: at rest
    assert textlayer.text_state(item, 2.75).alpha == pytest.approx(1 - 0.5**3)  # leaving, halfway
    words = TextItem(id="w", text="one two three four", start=0, end=2, anim_in=TextAnim(kind="words", duration=1))
    assert [textlayer.text_state(words, t).words for t in (0, 0.3, 0.6, 0.99, 1.5)] == [1, 2, 3, 4, None]


def test_animated_text_draws_per_frame_and_changes(tmp_path: Path) -> None:
    from unittest.mock import patch

    from auteur.timeline.models import TextAnim

    tl = Timeline(fps=10, texts=[TextItem(id="t", text="Hello", start=0, end=2, style="title",
                                          anim_in=TextAnim(kind="slide_up", duration=0.5))])
    with patch.object(Timeline, "duration", new=2.0):  # no clips needed for the text track
        listing = textlayer.text_track(tl, 320, 180, tmp_path)
    entries = [line for line in listing.read_text().splitlines() if line.startswith("duration")]
    assert len(entries) >= 6  # 5 frames of entrance at 10 fps, then the rest at once
    pictures = sorted(tmp_path.glob("txt_*.png"), key=lambda p: int(p.stem.split("_")[1]))
    first, last = Image.open(pictures[0]), Image.open(pictures[-1])
    assert first.getbbox()[1] > last.getbbox()[1]  # it rose into place
    assert first.getchannel("A").getextrema()[1] < last.getchannel("A").getextrema()[1]  # and faded in
