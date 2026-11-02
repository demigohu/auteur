"""Measures word-timing error against a fixture from make_timing_fixture.py, for the streaming-only
estimate and the energy alignment, on the same API events.

Usage: uv run python scripts/eval_timing.py data/probe/align [--verbose]
"""

import difflib
import json
import re
import sys
from pathlib import Path

from auteur.transcript import envelope, align_turn, transcribe, words_from_events


def norm(w: str) -> str:
    return re.sub(r"[^\w]", "", w.lower())


def score(name: str, truth: list[dict], words: list, verbose: bool) -> None:
    sm = difflib.SequenceMatcher(a=[norm(w["text"]) for w in truth], b=[norm(w.text) for w in words], autojunk=False)
    errs = []
    for block in sm.get_matching_blocks():
        for k in range(block.size):
            tw, ew = truth[block.a + k], words[block.b + k]
            errs.append((tw["text"], ew.start - tw["start"], ew.end - tw["end"]))
    n = max(len(errs), 1)
    mae_s = sum(abs(e[1]) for e in errs) / n
    mae_e = sum(abs(e[2]) for e in errs) / n
    within = sum(1 for e in errs if abs(e[1]) <= 0.15) / n
    print(f"{name:10} matched {len(errs)}/{len(truth)} | start MAE {mae_s:.3f}s | end MAE {mae_e:.3f}s | starts within 150ms {within:.0%}")
    if verbose:
        print("   " + " ".join(f"{w}:{s:+.2f}" for w, s, _ in errs))


def main(d: Path, verbose: bool) -> None:
    truth = json.loads((d / "truth.json").read_text())
    cache = d / "transcript.json"
    events_file = cache.with_suffix(".events.json")
    if not events_file.exists():
        cache.unlink(missing_ok=True)
        transcribe(d / "speech.wav", cache)
    events = json.loads(events_file.read_text())
    turns = words_from_events(events)
    env = envelope(d / "speech.wav")
    score("streaming", truth, [w for t in turns for w in t.words], verbose)
    score("aligned", truth, [w for t in turns for w in align_turn(t, env).words], verbose)


if __name__ == "__main__":
    main(Path(sys.argv[1]), "--verbose" in sys.argv)
