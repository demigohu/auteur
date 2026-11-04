"""Speech from text with Meta's MMS-TTS (open weights, run on CPU): voice-overs and dubbing.

Muse Voice Transcribe only listens, so speech comes from MMS-TTS (facebook/mms-tts-*). Each language has
one voice; "deeper" and "brighter" shift its pitch without changing its pace. Models download once into
the data directory (about 145 MB per language) and stay loaded. The weights are CC BY-NC 4.0: fine for this
non-commercial project, not for a paid product.

Dubbing translates the subtitles, speaks each line at its subtitle's time (sped up to fit its slot, at
most 1.6x), mixes the lines into one track, and turns the original sound down under it.
"""

import os
import re
import subprocess
import tempfile
import threading
import wave
from pathlib import Path

import numpy as np

from auteur.config import settings

# Latin-script languages MMS-TTS speaks without romanization (checked on the Hub).
LANGUAGES = {
    "English": "eng", "Indonesian": "ind", "Spanish": "spa", "French": "fra", "German": "deu", "Portuguese": "por",
    "Dutch": "nld", "Tagalog": "tgl", "Vietnamese": "vie", "Malay": "zlm", "Javanese": "jav", "Sundanese": "sun",
    "Swahili": "swh", "Turkish": "tur", "Polish": "pol",
}
VOICES = {"natural": 1.0, "deeper": 0.88, "brighter": 1.12}  # pitch factor
MAX_FIT = 1.6  # the most a dubbed line is sped up to fit its subtitle
SAMPLE_RATE = 16000

_models: dict[str, tuple] = {}
_lock = threading.Lock()


class TTSError(ValueError):
    pass


def _model(code: str):
    with _lock:
        if code not in _models:
            os.environ.setdefault("HF_HOME", str(settings.data_dir / "models"))
            from transformers import AutoTokenizer, VitsModel  # noqa: PLC0415 (heavy; only when speaking)

            name = f"facebook/mms-tts-{code}"
            try:
                _models[code] = (VitsModel.from_pretrained(name).eval(), AutoTokenizer.from_pretrained(name))
            except Exception as e:
                raise TTSError(f"Couldn't load the {code} voice: {e}") from None
        return _models[code]


def _sentences(text: str) -> list[str]:
    parts = [p.strip() for p in re.split(r"(?<=[.!?…])\s+|\n+", text) if p.strip()]
    return parts or [text.strip()]


def check_language(language: str) -> None:
    if language not in LANGUAGES:
        raise TTSError(f"No voice for {language!r}; available: {', '.join(LANGUAGES)}")


def speak(text: str, language: str) -> np.ndarray:
    """Float32 mono samples at SAMPLE_RATE; sentences joined with short pauses."""
    check_language(language)
    import torch  # noqa: PLC0415

    model, tok = _model(LANGUAGES[language])
    pause = np.zeros(int(0.25 * SAMPLE_RATE), dtype=np.float32)
    chunks = []
    for sentence in _sentences(text):
        inputs = tok(sentence, return_tensors="pt")
        if inputs["input_ids"].shape[-1] == 0:
            continue
        with torch.no_grad():
            chunks += [model(**inputs).waveform[0].numpy().astype(np.float32), pause]
    if not chunks:
        raise TTSError("Nothing to say: the text has no speakable words for this language")
    return np.concatenate(chunks[:-1])


def _write_wav(samples: np.ndarray, path: Path, rate: int = SAMPLE_RATE) -> Path:
    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return path


def _ffmpeg_audio(src: Path, out: Path, filters: str) -> np.ndarray:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-af", filters, "-ar", str(SAMPLE_RATE), "-ac", "1", str(out)],
                   check=True, capture_output=True)
    with wave.open(str(out)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32767


def shape(samples: np.ndarray, voice: str = "natural", speed: float = 1.0) -> np.ndarray:
    """Pitch (voice) and pace (speed) changes, independent of each other."""
    pitch = VOICES.get(voice, 1.0)
    if pitch == 1 and abs(speed - 1) < 1e-3:
        return samples
    tempo = speed / pitch  # asetrate changes pitch and pace together; atempo puts the pace back
    filters = [f"asetrate={SAMPLE_RATE * pitch:.0f}", f"aresample={SAMPLE_RATE}"]
    while tempo > 2:
        filters.append("atempo=2")
        tempo /= 2
    while tempo < 0.5:
        filters.append("atempo=0.5")
        tempo /= 0.5
    filters.append(f"atempo={tempo:.4f}")
    with tempfile.TemporaryDirectory() as tmp:
        return _ffmpeg_audio(_write_wav(samples, Path(tmp) / "in.wav"), Path(tmp) / "out.wav", ",".join(filters))


def voiceover(text: str, language: str, voice: str, speed: float, out: Path) -> Path:
    """A spoken WAV of `text` (blocking; call in a thread)."""
    check_language(language)
    return _write_wav(shape(speak(text, language), voice, speed), out)


def dub_track(lines: list[tuple[float, float, str]], language: str, voice: str, duration: float, out: Path) -> Path:
    """One WAV as long as the video, with each (start, end, text) line spoken at its start, sped up (up to
    MAX_FIT) to end by the next line's start."""
    check_language(language)
    track = np.zeros(int((duration + 1) * SAMPLE_RATE), dtype=np.float32)
    starts = [s for s, _, _ in lines] + [duration]
    for k, (start, end, text) in enumerate(lines):
        said = speak(text, language)
        slot = max(0.3, starts[k + 1] - start - 0.1)  # a breath before the next line
        fit = min(MAX_FIT, max(1.0, len(said) / SAMPLE_RATE / slot))
        said = shape(said, voice, fit)
        i = int(start * SAMPLE_RATE)
        part = said[: max(0, len(track) - i)]
        track[i:i + len(part)] += part
    return _write_wav(track[: int(duration * SAMPLE_RATE)], out)
