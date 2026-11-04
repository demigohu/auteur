"""Background removal with SAM 3.1 masks: pixel masks of the subject over a whole media file.

SAM gets the same 15 fps, 640 px proxy as tracking, in 5 s segments (object ids run out on longer
ones), in parallel. Each frame's masks (box-local rasters placed at their bounds) become one grayscale
frame: the main subject only (the largest object of each segment) or everything that matched. The frames
are written as a video at proxy size; the export scales it to the source and uses it as alpha
(render.bg_remove_chain), and the editor previews a variant with the background already replaced.
"""

import asyncio
import base64
import hashlib
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

import numpy as np
from meta_sam_parser import (
    CompletedOutcome,
    SegmentationMaskRecord,
    decode_mask_to_raster,
    parse_responses_stream,
    video_segmentation_format,
)
from openai import AsyncOpenAI

from auteur.config import settings
from auteur.media import media_dir, probe, sam_proxy
from auteur.tracking import PARALLEL, SAM_FPS, SEGMENT_SECONDS

HOLD_FRAMES = 7  # a missed detection keeps the last mask for half a second


class MaskError(RuntimeError):
    pass


def mask_name(prompt: str, keep: str) -> str:
    return f"mask-{hashlib.sha1(f'{prompt.strip().lower()}:{keep}'.encode()).hexdigest()[:10]}.mp4"


def mask_path(project_dir: Path, media_id: str, prompt: str, keep: str) -> Path:
    return media_dir(project_dir, media_id) / mask_name(prompt, keep)


async def _segment(client: AsyncOpenAI, video: Path, prompt: str) -> list[SegmentationMaskRecord]:
    url = "data:video/mp4;base64," + base64.b64encode(video.read_bytes()).decode()
    events = await client.responses.create(
        model="sam-3.1",
        input=[{"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": prompt}, {"type": "input_video", "video_url": url},
        ]}],
        stream=True,
        metadata={"mask_encoding": "one_bit"},
    )
    result = await parse_responses_stream(events, video_segmentation_format()).final_result()
    if not isinstance(result.outcome, CompletedOutcome):
        raise MaskError(f"SAM did not complete: {result.outcome}")
    return [r for r in result.records if isinstance(r, SegmentationMaskRecord) and r.frame is not None]


def _frames(records: list[SegmentationMaskRecord], count: int, w: int, h: int, keep: str) -> list[np.ndarray]:
    """One 0/255 mask per frame of a segment."""
    if keep == "main" and records:
        # The subject: the object covering the most pixels over the segment.
        area: dict[str, float] = {}
        for r in records:
            area[r.object_id] = area.get(r.object_id, 0) + (r.bounds.right - r.bounds.left) * (r.bounds.bottom - r.bounds.top)
        main = max(area, key=area.get)
        records = [r for r in records if r.object_id == main]
    frames = [np.zeros((h, w), np.uint8) for _ in range(count)]
    seen = [False] * count
    for r in records:
        k = r.frame.frame_index
        if not 0 <= k < count:
            continue
        raster = np.frombuffer(decode_mask_to_raster(r.mask), np.uint8).reshape(r.mask.height, r.mask.width)
        x0, y0 = int(round(r.bounds.left)), int(round(r.bounds.top))
        x1, y1 = min(w, x0 + r.mask.width), min(h, y0 + r.mask.height)
        if x1 > x0 and y1 > y0:
            frames[k][y0:y1, x0:x1] |= (raster[: y1 - y0, : x1 - x0] > 0).astype(np.uint8) * 255
            seen[k] = True
    # Bridge short dropouts with the last mask.
    last, gap = None, 0
    for k in range(count):
        if seen[k]:
            last, gap = frames[k], 0
        elif last is not None and gap < HOLD_FRAMES:
            frames[k], gap = last, gap + 1
    return frames


async def make_mask(
    project_dir: Path, media_id: str, prompt: str, keep: str, on_progress: Callable[[float], None] | None = None,
) -> tuple[Path, int]:
    """Write the mask video for a media file (once; cached by prompt and mode). Returns it and the number of
    frames SAM was billed for (0 when cached)."""
    out = mask_path(project_dir, media_id, prompt, keep)
    if out.exists():
        return out, 0
    proxy = await asyncio.to_thread(sam_proxy, project_dir, media_id)
    info = await asyncio.to_thread(probe, proxy)
    w, h = info["width"], info["height"]
    total = max(1, round(info["duration"] * SAM_FPS))
    per = SEGMENT_SECONDS * SAM_FPS
    count = -(-total // per)
    client = AsyncOpenAI(api_key=settings.meta_api_key, base_url=settings.meta_base_url)
    gate = asyncio.Semaphore(PARALLEL)
    done = 0

    with tempfile.TemporaryDirectory() as tmp:
        async def run(k: int) -> list[np.ndarray]:
            nonlocal done
            seg = Path(tmp) / f"seg{k}.mp4"
            await asyncio.to_thread(subprocess.run, [
                "ffmpeg", "-y", "-loglevel", "error", "-i", str(proxy),
                "-vf", f"select='between(n\\,{k * per}\\,{(k + 1) * per - 1})',setpts=N/{SAM_FPS}/TB",
                "-r", str(SAM_FPS), "-c:v", "libx264", "-crf", "26", "-pix_fmt", "yuv420p", str(seg),
            ], check=True)
            async with gate:
                for attempt in range(2):
                    try:
                        records = await _segment(client, seg, prompt)
                        break
                    except Exception:
                        if attempt:
                            raise
            done += 1
            if on_progress:
                on_progress(done / count)
            return _frames(records, min(per, total - k * per), w, h, keep)

        segments = await asyncio.gather(*(run(k) for k in range(count)))
        frames = [f for seg in segments for f in seg]
        if not any(f.any() for f in frames):
            raise MaskError(f"SAM found no {prompt!r} in this footage")
        partial = out.with_suffix(".partial.mp4")
        proc = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}", "-r", str(SAM_FPS),
             "-i", "-", "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p", str(partial)],
            input=b"".join(f.tobytes() for f in frames), capture_output=True,
        )
        if proc.returncode != 0:
            raise MaskError(proc.stderr.decode(errors="replace")[-300:])
        partial.replace(out)
    # SAM bills each request for at least 50 frames.
    return out, sum(max(50, min(per, total - k * per)) for k in range(count))
