import re
from pathlib import Path

from auteur import subtitles
from auteur.textlayer import active_word, text_track
from auteur.timeline import Media, Project
from auteur.timeline.models import TextWord
from auteur.timeline.ops import AddClip, AddText, UpdateText
from auteur.transcript import clean_partial


def test_clean_partial_drops_recognizer_restart() -> None:
    assert clean_partial("Kemarin akuKemarin aku nyoba") == "Kemarin aku nyoba"
    assert clean_partial("Halo semuanya") == "Halo semuanya"
    assert clean_partial("pakai iPhone baru") == "pakai iPhone baru"  # inner capital, not a restart
    # Recognizer control tokens are not words.
    assert clean_partial("lima satu <|speaker_A|>  nah sekarang") == "lima satu nah sekarang"


def test_old_transcripts_are_rebuilt_from_their_events(tmp_path: Path) -> None:
    """A cache from before the token fix is redone from the saved stream, without calling the API."""
    import json
    import subprocess

    from auteur import transcript
    from auteur.transcript import Transcript, Turn, Word

    d = tmp_path / "media" / "m"
    d.mkdir(parents=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=300:d=3", "-c:a", "aac", str(d / "source.m4a")],
                   check=True)
    events = [
        {"type": "speechStart", "audioProcessedMs": 200},
        {"type": "transcript", "audioProcessedMs": 900, "transcript": "lima"},
        {"type": "transcript", "audioProcessedMs": 1500, "transcript": "lima satu <|speaker_A|>"},
        {"type": "transcript", "audioProcessedMs": 2400, "transcript": "lima satu <|speaker_A|> nah"},
        {"type": "speechComplete", "audioProcessedMs": 2600, "transcript": "lima satu <|speaker_A|> nah"},
    ]
    (d / "transcript.events.json").write_text(json.dumps(events))
    stale = Transcript(duration=3, silences=[], turns=[Turn(start=0.2, end=2.6, text="lima satu <|speaker_A|> nah", words=[
        Word(text=w, start=0.2 + i * 0.5, end=0.6 + i * 0.5) for i, w in enumerate(["lima", "satu", "<|speaker_A|>", "nah"])
    ])])
    assert stale.version == 1
    (d / "transcript.json").write_text(stale.model_dump_json())

    t = transcript.load(d / "transcript.json")
    assert t.version == transcript.TRANSCRIPT_VERSION
    assert [w.text for w in t.turns[0].words] == ["lima", "satu", "nah"]
    assert Transcript.model_validate_json((d / "transcript.json").read_text()).version == transcript.TRANSCRIPT_VERSION  # saved


def test_word_cuts_reach_into_nearby_silence() -> None:
    from auteur import transcript_edit

    silences = [(10.75, 12.69)]
    # The estimated end (10.61) stops short of the word's tail; the silence 0.14s later is where it ends.
    assert transcript_edit.snap([(10.21, 10.61)], silences) == [(10.21, 10.75)]
    assert transcript_edit.snap([(3.0, 3.4)], silences) == [(3.0, 3.4)]  # no silence near: unchanged


def test_chunks_break_at_sentences_and_fit_two_lines() -> None:
    words = [(i * 0.4, i * 0.4 + 0.35, w) for i, w in enumerate("aku cakep enggak? cakep banget deh emang ya lah".split())]
    chunks = subtitles.chunk(words, max_words=5)
    assert [w[2] for w in chunks[0]] == ["aku", "cakep", "enggak?"]
    for ws, text in subtitles.fit(chunks, "karaoke", 1080, 1920):
        assert len(text.split("\n")) <= subtitles.MAX_LINES
        assert text.replace("\n", " ").split() == [w[2] for w in ws]


def test_corrected_words_keep_or_respread_timing() -> None:
    original = [(1.0, 1.4, "suer"), (1.5, 2.0, "supil")]
    same = subtitles.timed_words(original, "Suer, sumpah.", ["sumpah"])
    assert [(w.start, w.end) for w in same] == [(1.0, 1.4), (1.5, 2.0)] and same[1].emphasis
    more = subtitles.timed_words(original, "suer suer sumpah", [])
    assert more[0].start == 1.0 and more[-1].end == 2.0 and len(more) == 3


def make_project() -> Project:
    p = Project(id="p", name="t")
    p.media["m"] = Media(id="m", name="m", path="m.mp4", duration=10, fps=30, width=1080, height=1920, has_audio=True)
    words = [TextWord(text=w, start=0.5 + i * 0.5, end=0.9 + i * 0.5) for i, w in enumerate(["aku", "cakep", "banget"])]
    p.commit("user", "x", [
        AddClip(media_id="m", src_in=0, src_out=6),
        AddText(id="s", text="aku cakep\nbanget", start=0.5, end=2.2, look="karaoke", words=words),
        AddText(id="t", text="Jalan Malam", start=0, end=1.0, style="title", y=0.2),
    ])
    return p


def test_editing_text_respreads_words() -> None:
    p = make_project()
    p.commit("user", "edit", [UpdateText(text_id="s", text="aku cakep\nbanget deh")])
    item = next(t for t in p.timeline.texts if t.id == "s")
    assert [w.text for w in item.words] == ["aku", "cakep", "banget", "deh"]
    assert item.words[0].start == 0.5 and item.words[-1].end == 2.2


def test_text_track_covers_timeline_with_one_image_per_state(tmp_path: Path) -> None:
    p = make_project()
    listing = text_track(p.timeline, 270, 480, tmp_path)
    durations = [float(x) for x in re.findall(r"duration ([\d.]+)", listing.read_text())]
    assert abs(sum(durations) - p.timeline.duration) < 1e-3
    # blank, title, title+word0, word0, word1, word2, blank -> six distinct images at most
    assert len(list(tmp_path.glob("txt_*.png"))) <= 7
    item = next(t for t in p.timeline.texts if t.id == "s")
    assert active_word(item, 0.4) == -1 and active_word(item, 1.2) == 1
