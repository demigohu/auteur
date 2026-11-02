"""Speech: Muse Voice Transcribe plus the timing it doesn't give us.

The API returns turn-level times only. In stream mode it also emits partial transcripts as words are
recognized, each stamped with how much audio had been processed. A word's end is estimated from when
it first appeared, minus the recognizer's typical lag, and cut points are then snapped to real
silences found by ffmpeg, so a filler cut lands in a pause rather than mid-syllable.
"""

import json
import re
import subprocess
from pathlib import Path

import httpx

from auteur.config import settings
from auteur.timeline.models import Model

RECOGNIZER_LAG = 0.35  # seconds between a word ending and it showing up in a partial transcript
FILLERS = {"eh", "ehm", "em", "emm", "eee", "ee", "hmm", "hm", "mm", "uh", "um", "uhm", "ah", "anu", "eeh"}


class Word(Model):
    text: str
    start: float
    end: float

    @property
    def is_filler(self) -> bool:
        return re.sub(r"[^\w]", "", self.text.lower()) in FILLERS


class Turn(Model):
    start: float
    end: float
    text: str
    words: list[Word]


class Transcript(Model):
    duration: float
    turns: list[Turn]
    silences: list[tuple[float, float]]

    def lines(self) -> str:
        """Compact form for the agent: one line per turn, filler words marked."""
        out = []
        for t in self.turns:
            text = " ".join(f"[{w.text}]" if w.is_filler else w.text for w in t.words) or t.text
            out.append(f"{t.start:6.2f}-{t.end:6.2f}  {text}")
        return "\n".join(out) or "(no speech)"


def _to_wav(source: Path, wav: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(source), "-vn", "-ac", "1", "-ar", "24000",
         "-c:a", "pcm_s16le", str(wav)],
        check=True,
    )


def detect_silences(wav: Path, below_mean_db: float = 12, min_len: float = 0.15) -> list[tuple[float, float]]:
    """Pauses quieter than the clip's mean loudness by `below_mean_db`; a fixed threshold misses
    every pause in noisy outdoor footage, where background noise sits near speech level."""
    vol = subprocess.run(
        ["ffmpeg", "-i", str(wav), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True,
    )
    mean = float(m.group(1)) if (m := re.search(r"mean_volume: (-?[\d.]+) dB", vol.stderr)) else -30.0
    proc = subprocess.run(
        ["ffmpeg", "-i", str(wav), "-af", f"silencedetect=noise={mean - below_mean_db}dB:d={min_len}", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", proc.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", proc.stderr)]
    return [(round(a, 3), round(b, 3)) for a, b in zip(starts, ends)]


def words_from_events(events: list[dict]) -> list[Turn]:
    turns: list[Turn] = []
    start: float | None = None
    shown = ""
    words: list[Word] = []
    last_t = 0.0
    for e in events:
        t = e.get("audioProcessedMs", 0) / 1000
        match e["type"]:
            case "speechStart":
                start, shown, words, last_t = t, "", [], t
            case "transcript" if start is not None and e["transcript"].startswith(shown):
                new = e["transcript"][len(shown):].split()
                if new:
                    # Words that arrive together share the span since the previous update.
                    end = max(last_t, t - RECOGNIZER_LAG)
                    step = (end - last_t) / len(new)
                    for i, w in enumerate(new):
                        words.append(Word(text=w, start=round(last_t + i * step, 3), end=round(last_t + (i + 1) * step, 3)))
                    last_t = end
                shown = e["transcript"]
            case "speechComplete" if start is not None:
                end = t
                text = e.get("transcript", shown)
                if words:
                    words[-1] = words[-1].model_copy(update={"end": max(words[-1].end, min(end, words[-1].end + 1))})
                turns.append(Turn(start=round(start, 3), end=round(end, 3), text=text, words=words))
                start = None
    return turns


def transcribe(source: Path, cache: Path) -> Transcript:
    if cache.exists():
        return Transcript.model_validate_json(cache.read_text())
    wav = cache.with_suffix(".wav")
    _to_wav(source, wav)
    config = {"model": "muse-voice-transcribe-1.0", "audioEncoding": "WAV", "mode": "ENDPOINTING",
              "languageBias": ["id", "en"]}
    r = httpx.post(
        f"{settings.meta_base_url}/asr/transcribe",
        timeout=600,
        headers={"Authorization": f"Bearer {settings.meta_api_key}", "Accept": "text/event-stream"},
        files={
            "request": (None, json.dumps(config), "application/json"),
            "audio": ("audio.wav", wav.read_bytes(), "audio/wav"),
        },
    )
    r.raise_for_status()
    events = [json.loads(line[5:]) for line in r.text.splitlines() if line.startswith("data:")]
    if errors := [e for e in events if e["type"] == "error"]:
        raise RuntimeError(f"Transcription failed: {errors[0]}")
    duration = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)],
        capture_output=True, text=True, check=True,
    ).stdout)
    t = Transcript(duration=round(duration, 3), turns=words_from_events(events), silences=detect_silences(wav))
    cache.write_text(t.model_dump_json())
    wav.unlink(missing_ok=True)
    return t


def _snap(t: float, silences: list[tuple[float, float]], window: float = 0.4) -> float:
    """Move a cut point into the nearest silence within `window` seconds, if there is one."""
    best, dist = t, window
    for a, b in silences:
        target = min(max(t, a), b)
        if abs(target - t) <= dist:
            best, dist = target, abs(target - t)
    return best


def cut_ranges(t: Transcript, min_silence: float = 0.8, keep_pause: float = 0.25) -> list[tuple[float, float]]:
    """Source-time ranges to remove: filler words and pauses longer than `min_silence`.

    Pauses are measured silences plus the gaps between speech turns (the recognizer's own voice
    activity detection, which still works when background noise hides silences). A short pause is
    kept on each side so speech doesn't sound clipped.
    """
    cuts: list[tuple[float, float]] = []
    for turn in t.turns:
        for w in turn.words:
            if w.is_filler:
                cuts.append((_snap(w.start, t.silences), _snap(w.end, t.silences)))
    gaps = [(a.end, b.start) for a, b in zip(t.turns, t.turns[1:])]
    if t.turns:
        gaps += [(0.0, t.turns[0].start), (t.turns[-1].end, t.duration)]
    for a, b in [*t.silences, *gaps]:
        if b - a >= min_silence:
            cuts.append((a + keep_pause, b - keep_pause))
    cuts = sorted((round(a, 3), round(b, 3)) for a, b in cuts if b - a > 0.05)
    merged: list[tuple[float, float]] = []
    for a, b in cuts:
        if merged and a <= merged[-1][1] + 0.05:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return merged
