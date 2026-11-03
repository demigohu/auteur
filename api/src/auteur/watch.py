"""`watch`: Muse Spark looks at sampled frames and describes what happens on screen, scene by scene.

Frames are sampled about once per second (fewer for long media) at 384px, each labeled with its
source time, and sent in one request. The default description is cached per media; a request with
a specific focus ("when is the cake on screen?") is not.
"""

import base64
import subprocess
import tempfile
from pathlib import Path

from openai import AsyncOpenAI

from auteur import costs
from auteur.config import settings
from auteur.timeline.models import Media

MODEL = "muse-spark-1.3"
MAX_FRAMES = 48

PROMPT = """These are frames from one video file, in order, each labeled with its time in seconds.
Describe what is on screen as a list of scenes. One line per scene, exactly in this form:
<start>-<end>: <what is visible: people (by appearance, never guessed names), action, place, framing> | energy <1-5>
Merge consecutive frames that show the same scene. Mention camera problems (blur, dark, pointing at the floor).
Times are seconds; use the frame labels. Be concrete and short."""


def _sample(m: Media, workdir: Path) -> list[tuple[float, Path]]:
    n = max(1, min(MAX_FRAMES, round(m.duration)))
    step = m.duration / n
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(Path(m.path).resolve()),
         "-vf", f"fps=1/{step:.4f},scale='if(gt(iw,ih),384,-2)':'if(gt(iw,ih),-2,384)'", "-q:v", "6",
         str(workdir / "f%03d.jpg")],
        check=True,
    )
    frames = sorted(workdir.glob("f*.jpg"))
    return [(round(i * step + step / 2, 1), f) for i, f in enumerate(frames)]


async def watch(m: Media, cache: Path, focus: str | None = None) -> tuple[str, float]:
    """Scene description and what the call cost in USD (0 when cached)."""
    if focus is None and cache.exists():
        return cache.read_text(), 0.0
    with tempfile.TemporaryDirectory() as tmp:
        frames = _sample(m, Path(tmp))
        content: list[dict] = [{"type": "input_text", "text": PROMPT + (f"\n\nAlso answer specifically: {focus}" if focus else "")}]
        for t, f in frames:
            content.append({"type": "input_text", "text": f"t={t}s"})
            content.append({"type": "input_image", "image_url": "data:image/jpeg;base64," + base64.b64encode(f.read_bytes()).decode()})
    client = AsyncOpenAI(api_key=settings.meta_api_key, base_url=settings.meta_base_url)
    r = await client.responses.create(model=MODEL, input=[{"role": "user", "content": content}])
    text = r.output_text.strip()
    if focus is None:
        cache.write_text(text)
    return text, costs.spark(r.usage)
