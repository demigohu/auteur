"""Pictures made with Muse Image: the media bin's Generate box and the agent's generate_image tool.
A generated picture becomes an ordinary still (media.ingest), so it edits like an uploaded PNG."""

import base64
import tempfile
from pathlib import Path

from openai import OpenAI

from auteur.config import settings
from auteur.media import MediaError, ingest
from auteur.timeline.models import Media

MODEL = "muse-image-1.0"
PRICE = 0.01  # USD per returned image (dev.meta.ai/docs/pricing-rate-limits)
# Muse Image takes the size as an aspect ratio; these match the timeline's formats.
SIZES = {"16:9": "1792x1024", "9:16": "1024x1792", "1:1": "1024x1024", "4:5": "1024x1280"}


class ImageGenError(ValueError):
    pass


def generate(project_dir: Path, media_id: str, prompt: str, aspect: str) -> Media:
    """Generate one picture for `prompt` at the aspect and ingest it as a still. Blocking (call in a thread)."""
    client = OpenAI(api_key=settings.meta_api_key, base_url=settings.meta_base_url)
    try:
        r = client.images.generate(model=MODEL, prompt=prompt, size=SIZES.get(aspect, SIZES["16:9"]), output_format="png", n=1)
    except Exception as e:  # the API's own message (safety refusals, limits) is the useful part
        raise ImageGenError(f"Muse Image couldn't make it: {e}") from None
    if not r.data or not r.data[0].b64_json:
        raise ImageGenError("Muse Image returned no picture")
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "generated.png"
        png.write_bytes(base64.b64decode(r.data[0].b64_json))
        name = "Generated: " + " ".join(prompt.split())[:48]
        try:
            return ingest(project_dir, media_id, name, png)
        except MediaError as e:
            raise ImageGenError(str(e)) from None
