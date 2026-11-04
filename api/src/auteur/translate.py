"""Translating the timeline's text with Muse Spark: one call for every line, structured output so each
line comes back in its place. Subtitles are re-wrapped for the frame and their word timings spread over
the new words (UpdateText does that when the text changes)."""

from typing import Any

from openai import AsyncOpenAI

from auteur import costs
from auteur.config import settings
from auteur.subtitles import wrap
from auteur.timeline import Project
from auteur.timeline.ops import Op, UpdateText

MODEL = "muse-spark-1.3"

PROMPT = """Translate each line into {language}. These are on-screen texts of one video (subtitles and
titles), in order, so keep the meaning across lines consistent. Keep each line about as short as the
original: they must be read in the same time. Keep names, brands and numbers as they are. If a line is
already in {language}, return it unchanged. Return every line, with its index."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["lines"],
    "properties": {"lines": {"type": "array", "items": {
        "type": "object", "additionalProperties": False, "required": ["i", "text"],
        "properties": {"i": {"type": "integer"}, "text": {"type": "string"}},
    }}},
}


class TranslateError(ValueError):
    pass


async def translate_lines(lines: list[str], language: str) -> tuple[list[str], float]:
    """The lines in `language` (same count and order) and the call's cost."""
    import json

    client = AsyncOpenAI(api_key=settings.meta_api_key, base_url=settings.meta_base_url)
    r = await client.responses.create(
        model=MODEL, instructions=PROMPT.format(language=language),
        input="\n".join(f"{i}: {ln}" for i, ln in enumerate(lines)),
        text={"format": {"type": "json_schema", "name": "translation", "schema": SCHEMA, "strict": True}},
    )
    usd = costs.spark(r.usage)
    try:
        items = {int(o["i"]): str(o["text"]).strip() for o in json.loads(r.output_text)["lines"]}
    except (ValueError, KeyError, TypeError):
        raise TranslateError("Muse Spark's translation came back unreadable; try again") from None
    if missing := [i for i in range(len(lines)) if not items.get(i)]:
        raise TranslateError(f"The translation skipped lines {missing[:5]}; try again")
    return [items[i] for i in range(len(lines))], usd


async def translate_ops(p: Project, language: str, subtitles_only: bool) -> tuple[list[Op], float]:
    """UpdateText ops that put the project's texts into `language`."""
    texts = [t for t in p.timeline.texts if t.style == "subtitle" or not subtitles_only]
    if not texts:
        raise TranslateError("There is no text on the timeline to translate")
    flat = [" ".join(t.text.split()) for t in texts]
    translated, usd = await translate_lines(flat, language)
    out_w, out_h = p.timeline.size
    ops: list[Op] = []
    for t, new in zip(texts, translated):
        # Subtitles are re-wrapped to fit the frame (the translation is a different length); titles keep
        # the user's own line breaks only when it is a single line.
        text = "\n".join(" ".join(line) for line in wrap(new.split(), t.look, out_w, out_h)) if t.style == "subtitle" else new
        if text != t.text:
            ops.append(UpdateText(text_id=t.id, text=text))
    return ops, usd
