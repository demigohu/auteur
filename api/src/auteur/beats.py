"""Tempo and beat times of a music track, so cuts can land on the beat.

A small numpy version of the classic approach (Ellis 2007): an onset-strength envelope from
spectral flux, the tempo from its autocorrelation (biased toward ~120 BPM), then the beat sequence
that best balances onset strength against a steady period, found by dynamic programming.
"""

import subprocess
from pathlib import Path

import numpy as np

from auteur.timeline.models import Model

SR = 22050
HOP = 512
FRAME = 2048


class Beats(Model):
    bpm: float
    beats: list[float]  # seconds
    downbeats: list[float]  # every 4th beat, starting at the strongest phase

    def nearest(self, t: float, max_shift: float = 0.35) -> float | None:
        best = min(self.beats, key=lambda b: abs(b - t), default=None)
        return best if best is not None and abs(best - t) <= max_shift else None


def _decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, np.float32)


def onset_envelope(x: np.ndarray) -> np.ndarray:
    n = 1 + max(0, (len(x) - FRAME) // HOP)
    idx = np.arange(FRAME)[None, :] + HOP * np.arange(n)[:, None]
    frames = np.pad(x, (0, FRAME))[idx] * np.hanning(FRAME)
    mag = np.log1p(100 * np.abs(np.fft.rfft(frames, axis=1)))
    flux = np.maximum(0, np.diff(mag, axis=0)).sum(1)
    flux = np.concatenate([[0], flux])
    flux -= np.convolve(flux, np.ones(16) / 16, mode="same")  # remove the slow trend
    flux = np.maximum(flux, 0)
    return flux / (flux.std() + 1e-9)


def tempo(env: np.ndarray) -> float:
    fps = SR / HOP
    ac = np.correlate(env, env, mode="full")[len(env) - 1 :]
    lags = np.arange(len(ac))
    bpm = 60 * fps / np.maximum(lags, 1)
    valid = (bpm >= 60) & (bpm <= 180)
    # Log-Gaussian preference around 120 BPM keeps half/double-time guesses down.
    weight = np.exp(-0.5 * (np.log2(np.maximum(bpm, 1) / 120) / 0.9) ** 2)
    score = np.where(valid, ac * weight, -np.inf)
    lag = int(np.argmax(score))
    # Refine with parabolic interpolation around the peak.
    if 1 <= lag < len(score) - 1 and np.isfinite(score[lag - 1]) and np.isfinite(score[lag + 1]):
        a, b, c = score[lag - 1], score[lag], score[lag + 1]
        lag = lag + 0.5 * (a - c) / (a - 2 * b + c + 1e-12)
    return float(60 * fps / lag)


def track_beats(env: np.ndarray, bpm: float, tightness: float = 100) -> np.ndarray:
    period = 60 * SR / HOP / bpm
    n = len(env)
    score = env.astype(np.float64).copy()
    back = -np.ones(n, dtype=np.int64)
    lo, hi = int(round(period / 2)), int(round(period * 2))
    for t in range(n):
        start, end = max(0, t - hi), t - lo
        if end <= start:
            continue
        prev = np.arange(start, end)
        penalty = -tightness * np.log((t - prev) / period) ** 2
        cand = score[prev] + penalty
        k = int(np.argmax(cand))
        if cand[k] > 0:
            score[t] += cand[k]
            back[t] = prev[k]
    # Start from the best-scoring frame in the last period and walk back.
    t = int(np.argmax(score[max(0, n - int(period)) :])) + max(0, n - int(period))
    beats = []
    while t >= 0:
        beats.append(t)
        t = int(back[t])
    return np.array(beats[::-1])


def analyze(path: Path) -> Beats:
    x = _decode(path)
    if len(x) < SR:
        return Beats(bpm=0, beats=[], downbeats=[])
    env = onset_envelope(x)
    bpm = tempo(env)
    frames = track_beats(env, bpm)
    # An onset peaks in the flux when it reaches the middle of the analysis window.
    times = [round(float((f * HOP + FRAME / 2) / SR), 3) for f in frames]
    # Downbeat phase: of the 4 possible phases, the one with the most onset energy.
    phase = int(np.argmax([env[frames[p::4]].sum() if len(frames[p::4]) else 0 for p in range(4)]))
    return Beats(bpm=round(bpm, 1), beats=times, downbeats=times[phase::4])
