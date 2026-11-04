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
import numpy as np

from auteur.config import settings
from auteur.timeline.models import Model
from auteur.timeline.ops import syllables

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
    version: int = 1  # caches written before versioning are 1
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


GLUE = re.compile(r"(?<=[a-z0-9.,!?])(?=[A-Z])")
# Recognizer control tokens that sometimes leak into the text, e.g. "<|speaker_A|>". Taken for a word they
# also took a share of the turn's voiced time, squeezing the real words around them.
SPECIAL = re.compile(r"<\|[^|>]*\|>")
# Bumped when word timing changes; older caches are rebuilt from their saved events (no API call).
TRANSCRIPT_VERSION = 2


def clean_partial(text: str) -> str:
    """Undo the recognizer restarting a turn mid-stream.

    Partials sometimes arrive as "Kemarin akuKemarin aku nyoba": the recognizer re-decoded the turn
    and glued the new version onto the old one without a space. When the glued-on part starts the
    same way as the turn, it supersedes everything before it.
    """
    text = " ".join(SPECIAL.sub(" ", text).split())
    parts = GLUE.split(text)
    if len(parts) > 1:
        first = _norm(parts[0].split()[0]) if parts[0].split() else ""
        for k in range(len(parts) - 1, 0, -1):
            words = parts[k].split()
            if words and _norm(words[0]) == first:
                return " ".join(parts[k:]) if k == len(parts) - 1 else "".join(parts[k:])
    return text


def _norm(word: str) -> str:
    return re.sub(r"[^\w]", "", word.lower())


def words_from_events(events: list[dict]) -> list[Turn]:
    turns: list[Turn] = []
    start: float | None = None
    words: list[Word] = []
    last_t = 0.0
    for e in events:
        t = e.get("audioProcessedMs", 0) / 1000
        match e["type"]:
            case "speechStart":
                start, words, last_t = t, [], t
            case "transcript" if start is not None and e["transcript"].strip():
                tokens = clean_partial(e["transcript"]).split()
                # Keep the words this partial agrees with; anything after the first disagreement was
                # revised by the recognizer and is replaced.
                keep = 0
                while keep < min(len(words), len(tokens)) and _norm(words[keep].text) == _norm(tokens[keep]):
                    words[keep] = words[keep].model_copy(update={"text": tokens[keep]})
                    keep += 1
                if keep < len(words):
                    last_t = words[keep - 1].end if keep else start
                    words = words[:keep]
                new = tokens[keep:]
                if new:
                    # Words that arrive together share the span since the previous update.
                    end = max(last_t, t - RECOGNIZER_LAG)
                    step = (end - last_t) / len(new)
                    for i, w in enumerate(new):
                        words.append(Word(text=w, start=round(last_t + i * step, 3), end=round(last_t + (i + 1) * step, 3)))
                    last_t = end
            case "speechComplete" if start is not None:
                end = t
                if words:
                    words[-1] = words[-1].model_copy(update={"end": max(words[-1].end, min(end, words[-1].end + 1))})
                text = " ".join(w.text for w in words) or clean_partial(e.get("transcript", ""))
                turns.append(Turn(start=round(start, 3), end=round(end, 3), text=text, words=words))
                start = None
    return turns


def load(cache: Path) -> Transcript | None:
    """A cached transcript, rebuilt from its saved events (no API call) when it predates the current word
    timing. The media's source file sits next to the cache."""
    if not cache.exists():
        return None
    t = Transcript.model_validate_json(cache.read_text())
    events = cache.with_suffix(".events.json")
    source = next(cache.parent.glob("source.*"), None)
    if t.version < TRANSCRIPT_VERSION and events.exists() and source is not None:
        wav = cache.with_suffix(".wav")
        _to_wav(source, wav)
        try:
            t = build_transcript(json.loads(events.read_text()), wav)
        finally:
            wav.unlink(missing_ok=True)
        cache.write_text(t.model_dump_json())
    return t


def transcribe(source: Path, cache: Path) -> Transcript:
    if (cached := load(cache)) is not None:
        return cached
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
    # Raw events are kept so word alignment can be re-run without calling the API again.
    cache.with_suffix(".events.json").write_text(json.dumps(events))
    t = build_transcript(events, wav)
    cache.write_text(t.model_dump_json())
    wav.unlink(missing_ok=True)
    return t


def build_transcript(events: list[dict], wav: Path) -> Transcript:
    duration = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)],
        capture_output=True, text=True, check=True,
    ).stdout)
    turns = words_from_events(events)
    env = envelope(wav)
    turns = [align_turn(t, env) for t in turns]
    return Transcript(version=TRANSCRIPT_VERSION, duration=round(duration, 3), turns=turns, silences=detect_silences(wav))


# --- word alignment -------------------------------------------------------------------------------
# The API gives turn boundaries (reliable) and words in order, but no word times. Within a turn the
# voiced parts are found from the audio energy, and each word gets a share of the voiced time
# proportional to its syllables. Word boundaries then snap to the small dips between voiced bursts,
# which is where words usually end. Measured against speech with known word times
# (scripts/make_timing_fixture.py + scripts/eval_timing.py).

HOP = 0.01  # seconds per envelope frame
STREAM_BIAS = 0.12  # streaming word times run this much early on average
CLAMP = 0.2  # max distance of an aligned word start from the bias-corrected streaming start


def envelope(wav: Path) -> np.ndarray:
    """RMS energy in dB per 10ms frame."""
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", str(wav), "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
        capture_output=True, check=True,
    ).stdout
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    n = int(16000 * HOP)
    frames = x[: len(x) // n * n].reshape(-1, n)
    return 20 * np.log10(np.sqrt((frames**2).mean(1)) + 1e-6)


def align_turn(turn: Turn, env: np.ndarray) -> Turn:
    if not turn.words:
        return turn
    a, b = int(turn.start / HOP), min(len(env), int(turn.end / HOP) + 1)
    seg = env[a:b]
    if len(seg) < 5:
        return turn
    floor, peak = np.percentile(seg, 10), np.percentile(seg, 95)
    if peak - floor < 6:  # no usable contrast (noisy footage): keep the streaming estimate
        return turn
    voiced = seg > floor + 0.3 * (peak - floor)
    idx = np.flatnonzero(voiced)
    if len(idx) < 3:
        return turn
    # Times of voiced frames, as one continuous "speech clock".
    times = (a + idx) * HOP
    weights = np.array([syllables(w.text) for w in turn.words], dtype=float)
    edges = np.concatenate([[0], np.cumsum(weights)]) / weights.sum() * (len(idx) - 1)
    starts = times[np.floor(edges[:-1]).astype(int)]
    ends = times[np.minimum(np.ceil(edges[1:]).astype(int), len(idx) - 1)] + HOP
    # Snap each internal boundary to the quietest frame nearby (word gaps are energy dips).
    for i in range(1, len(turn.words)):
        center = int(starts[i] / HOP)
        lo, hi = max(a, center - 12), min(b, center + 13)
        if hi > lo:
            dip = lo + int(np.argmin(env[lo:hi]))
            starts[i] = dip * HOP
            ends[i - 1] = dip * HOP
    # Energy alignment drifts when the recognizer hears extra words ("eh eh eh" for one long "eee");
    # the streaming estimate never drifts but runs early. Keep the aligned time within a window around
    # the bias-corrected streaming time: on the fixtures this put ~86% of word starts within 150ms of
    # the truth, versus ~37% for streaming alone.
    starts = [
        min(max(float(a_s), w.start + STREAM_BIAS - CLAMP), w.start + STREAM_BIAS + CLAMP)
        for w, a_s in zip(turn.words, starts)
    ]
    words = []
    for i, (w, st, e) in enumerate(zip(turn.words, starts, ends)):
        nxt = starts[i + 1] if i + 1 < len(starts) else turn.end
        end = min(max(float(e), st + 0.05), max(nxt, st + 0.05))
        words.append(w.model_copy(update={"start": round(st, 3), "end": round(end, 3)}))
    return turn.model_copy(update={"words": words})


def snap_to_silence(t: float, silences: list[tuple[float, float]], window: float = 0.4) -> float:
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
                cuts.append((snap_to_silence(w.start, t.silences), snap_to_silence(w.end, t.silences)))
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
