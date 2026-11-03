"""Meta Model API prices (dev.meta.ai/docs/pricing-rate-limits; Standard mode), used to show what each run costs."""

from typing import Any

SPARK_INPUT_PER_TOKEN = 1.25 / 1_000_000
SPARK_OUTPUT_PER_TOKEN = 4.25 / 1_000_000
WONDER_INPUT_PER_TOKEN = 4.00 / 1_000_000
WONDER_CACHED_INPUT_PER_TOKEN = 0.20 / 1_000_000
WONDER_OUTPUT_PER_TOKEN = 20.00 / 1_000_000  # reasoning tokens bill as output
SAM_VIDEO_PER_FRAME = 0.20 / 1000
TRANSCRIBE_PER_MINUTE = 3 / 1000


def spark(usage: Any) -> float:
    if usage is None:
        return 0.0
    return usage.input_tokens * SPARK_INPUT_PER_TOKEN + usage.output_tokens * SPARK_OUTPUT_PER_TOKEN


def wonder(usage: Any) -> float:
    if usage is None:
        return 0.0
    cached = getattr(getattr(usage, "input_tokens_details", None), "cached_tokens", None) or 0
    return (
        (usage.input_tokens - cached) * WONDER_INPUT_PER_TOKEN
        + cached * WONDER_CACHED_INPUT_PER_TOKEN
        + usage.output_tokens * WONDER_OUTPUT_PER_TOKEN
    )


def sam(frames: int) -> float:
    return frames * SAM_VIDEO_PER_FRAME


def transcribe(seconds: float) -> float:
    return seconds / 60 * TRANSCRIBE_PER_MINUTE
