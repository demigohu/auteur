"""Builds speech with known word times: each word synthesized alone (macOS `say`), joined with set pauses.

Usage: uv run python scripts/make_timing_fixture.py data/probe/align [--set 2]
Writes speech.wav and truth.json ([{"text", "start", "end"}]).
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

SENTENCES = [
    "halo semuanya selamat datang di vlog aku",
    "eee hari ini kita jalan jalan ke pantai",
    "cuacanya cerah banget dan anginnya enak",
    "hmm terus kita cari makan di pinggir jalan",
]
SENTENCES_2 = [
    "jadi gini guys aku mau cerita sedikit",
    "kemarin aku nyoba kopi baru di dekat kantor",
    "rasanya pahit tapi wanginya mantap banget",
    "nah besok aku mau ajak kalian ke sana",
    "jangan lupa like dan subscribe ya",
]
RATE = 24000


def synth(word: str, path: Path) -> np.ndarray:
    aiff = path.with_suffix(".aiff")
    subprocess.run(["say", "-v", "Damayanti", "-r", "190", "-o", str(aiff), word], check=True)
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", str(aiff), "-af", "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse",
         "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, np.int16)


def main(out: Path, alt: bool = False) -> None:
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(11 if alt else 7)
    sentences = SENTENCES_2 if alt else SENTENCES
    audio = [np.zeros(int(0.8 * RATE), np.int16)]
    t, truth = 0.8, []
    for sentence in sentences:
        for word in sentence.split():
            samples = synth(word, out / "w")
            truth.append({"text": word, "start": round(t, 3), "end": round(t + len(samples) / RATE, 3)})
            audio.append(samples)
            t += len(samples) / RATE
            gap = float(rng.uniform(0.0, 0.12) if alt else rng.uniform(0.04, 0.16))
            audio.append(np.zeros(int(gap * RATE), np.int16))
            t += int(gap * RATE) / RATE
        pause = float(rng.uniform(0.9, 1.6))
        audio.append(np.zeros(int(pause * RATE), np.int16))
        t += int(pause * RATE) / RATE
    pcm = np.concatenate(audio)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(RATE), "-ac", "1", "-i", "-", str(out / "speech.wav")],
        input=pcm.tobytes(), check=True,
    )
    (out / "truth.json").write_text(json.dumps(truth, indent=1))
    print(f"{len(truth)} words, {t:.1f}s -> {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1]), alt="--set" in sys.argv)
