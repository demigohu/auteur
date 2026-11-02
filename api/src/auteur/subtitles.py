"""Building subtitles from transcripts: grouping words into lines that fit, fixing misheard words.

Line breaks are decided here with the real font metrics (textlayer.font), so the renderer and the
editor preview, which both honor explicit line breaks, wrap identically.
"""

import json
import re

from openai import AsyncOpenAI

from auteur import costs
from auteur.config import settings
from auteur.textlayer import LOOK, font
from auteur.timeline.models import TextWord

MAX_WIDTH = 0.86  # fraction of the frame width a line may use
MAX_LINES = 2

Word = tuple[float, float, str]  # timeline start, end, text


def chunk(words: list[Word], max_words: int, max_seconds: float = 3.2) -> list[list[Word]]:
    """Group words into subtitle-sized chunks at pauses, sentence ends and length limits."""
    chunks: list[list[Word]] = []
    for w in sorted(words):
        cur = chunks[-1] if chunks else None
        if (
            cur is None or len(cur) >= max_words or w[0] - cur[-1][1] > 0.6
            or w[1] - cur[0][0] > max_seconds or cur[-1][2][-1] in ".?!"
        ):
            chunks.append([w])
        else:
            cur.append(w)
    return chunks


def wrap(tokens: list[str], look: str, out_w: int, out_h: int) -> list[list[str]]:
    """Greedy wrap by measured width; returns lines (may exceed MAX_LINES, the caller splits)."""
    sp = LOOK[look]
    f = font(sp.weight, max(8, round(out_h * sp.size)))
    limit = out_w * MAX_WIDTH
    lines: list[list[str]] = [[]]
    for tok in tokens:
        candidate = " ".join([*lines[-1], tok])
        if lines[-1] and f.getlength(candidate.upper() if sp.upper else candidate) > limit:
            lines.append([tok])
        else:
            lines[-1].append(tok)
    return lines


def fit(chunks: list[list[Word]], look: str, out_w: int, out_h: int) -> list[tuple[list[Word], str]]:
    """Each chunk as (words, text with line breaks), splitting chunks that need more than MAX_LINES."""
    out = []
    queue = list(chunks)
    while queue:
        ch = queue.pop(0)
        lines = wrap([w[2] for w in ch], look, out_w, out_h)
        if len(lines) > MAX_LINES and len(ch) > 1:
            half = len(ch) // 2
            queue[:0] = [ch[:half], ch[half:]]
            continue
        out.append((ch, "\n".join(" ".join(ln) for ln in lines)))
    return out


PROMPT = """You clean up automatic speech recognition for video subtitles. The speech is mostly Indonesian, \
sometimes mixed with English.

For each numbered line: fix words the recognizer misheard, using the surrounding lines and the scene \
description as context; fix capitalization and punctuation; drop stutters and accidental repeats \
("g guys" -> "guys", "anginnyanya" -> "anginnya"). Keep what was actually said and the speaker's casual style \
(do not make it formal, translate, summarize or add words). Keep each line's meaning in that line.
{emphasis}
Return only JSON: [{{"i": 0, "text": "...", "emphasis": ["word"]}}, ...] with one object per input line."""

EMPHASIS = "Also pick 0-1 key word per line worth highlighting (a strong noun, verb or emotion), as it appears in your text."


async def correct(lines: list[str], context: str, emphasis: bool) -> tuple[list[tuple[str, list[str]]], float]:
    """Corrected text and emphasized words per line, plus the call's cost. Falls back to the input."""
    if not lines:
        return [], 0.0
    client = AsyncOpenAI(api_key=settings.meta_api_key, base_url=settings.meta_base_url)
    numbered = "\n".join(f"{i}: {ln}" for i, ln in enumerate(lines))
    r = await client.responses.create(
        model="muse-spark-1.3",
        instructions=PROMPT.format(emphasis=EMPHASIS if emphasis else ""),
        input=f"Scene description:\n{context or '(none)'}\n\nLines:\n{numbered}",
    )
    usd = costs.spark(r.usage)
    fallback = [(ln, []) for ln in lines]
    m = re.search(r"\[.*\]", r.output_text, re.S)
    if not m:
        return fallback, usd
    try:
        items = {int(o["i"]): o for o in json.loads(m.group(0))}
    except (ValueError, KeyError, TypeError):
        return fallback, usd
    out = []
    for i, ln in enumerate(lines):
        o = items.get(i)
        text = str(o.get("text", "")).strip() if o else ""
        out.append((text or ln, [str(e) for e in (o or {}).get("emphasis", [])] if text else []))
    return out, usd


def _norm(w: str) -> str:
    return re.sub(r"[^\w]", "", w.lower())


def timed_words(original: list[Word], text: str, emphasis: list[str]) -> list[TextWord]:
    """Word timings for corrected text: kept per word when the word count is unchanged, otherwise
    spread by syllables over the chunk's span."""
    from auteur.timeline.ops import spread_words

    tokens = text.split()
    marks = {_norm(e) for e in emphasis}
    if len(tokens) == len(original):
        return [
            TextWord(text=tok, start=round(w[0], 3), end=round(w[1], 3), emphasis=_norm(tok) in marks)
            for tok, w in zip(tokens, original)
        ]
    spread = spread_words(" ".join(tokens), original[0][0], original[-1][1], [])
    return [w.model_copy(update={"emphasis": _norm(w.text) in marks}) for w in spread]
