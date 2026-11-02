"""Probe Meta Model API: Muse Spark (text, image, tool call), Voice Transcribe, SAM 3.1.

Usage: uv run python scripts/probe_meta.py [spark|transcribe|sam|all] [--video PATH] [--prompt TEXT]
"""

import argparse
import asyncio
import base64
import json
import mimetypes
import time
from pathlib import Path

from openai import AsyncOpenAI

from auteur.config import settings

PROBE_DIR = Path("data/probe")


def data_url(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def client() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=settings.meta_api_key, base_url=settings.meta_base_url)


async def probe_spark() -> None:
    async with client() as c:
        t = time.perf_counter()
        r = await c.responses.create(
            model="muse-spark-1.3",
            input=[
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": "Describe this video frame in one sentence."},
                        {"type": "input_image", "image_url": data_url(PROBE_DIR / "frame.jpg")},
                    ],
                }
            ],
        )
        print(f"[spark image] {time.perf_counter() - t:.1f}s usage={r.usage}")
        print(r.output_text)

        tools = [
            {
                "type": "function",
                "name": "trim_clip",
                "description": "Trim a clip on the timeline.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clip_id": {"type": "string"},
                        "start": {"type": "number"},
                        "end": {"type": "number"},
                    },
                    "required": ["clip_id", "start", "end"],
                    "additionalProperties": False,
                },
                "strict": True,
            }
        ]
        t = time.perf_counter()
        r = await c.responses.create(
            model="muse-spark-1.3",
            input="Clip c1 is 20s long. Cut it down to the 5 seconds starting at 3s.",
            tools=tools,
        )
        print(f"[spark tool] {time.perf_counter() - t:.1f}s")
        for item in r.output:
            if item.type == "function_call":
                print(item.name, item.arguments)


async def probe_transcribe(mode: str) -> None:
    import subprocess

    import httpx

    wav = PROBE_DIR / "speech.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(PROBE_DIR / "speech.aiff"),
         "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", str(wav)],
        check=True,
    )
    config = {"model": "muse-voice-transcribe-1.0", "audioEncoding": "WAV", "mode": mode}
    t = time.perf_counter()
    async with httpx.AsyncClient(timeout=120) as http:
        r = await http.post(
            f"{settings.meta_base_url}/asr/transcribe",
            headers={"Authorization": f"Bearer {settings.meta_api_key}", "Accept": "application/json"},
            files={
                "request": (None, json.dumps(config), "application/json"),
                "audio": ("speech.wav", wav.read_bytes(), "audio/wav"),
            },
        )
    print(f"[transcribe {mode}] HTTP {r.status_code} in {time.perf_counter() - t:.1f}s")
    try:
        print(json.dumps(r.json(), indent=1, ensure_ascii=False)[:4000])
    except ValueError:
        print(r.text[:4000])


def make_proxy(video: Path) -> Path:
    """Full-res 60fps uploads get the connection reset; SAM gets a 15fps 640p silent proxy."""
    import subprocess

    proxy = video.with_name(f"{video.stem}_proxy.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(video),
         "-vf", "fps=15,scale=-2:640", "-an", "-c:v", "libx264", "-crf", "26",
         "-pix_fmt", "yuv420p", str(proxy)],
        check=True,
    )
    return proxy


async def probe_sam(video: Path, prompt: str) -> None:
    video = make_proxy(video)
    from meta_sam_parser import (
        CompletedOutcome,
        SegmentationBoxRecord,
        SegmentationMaskRecord,
        parse_responses_stream,
        video_segmentation_format,
    )

    async with client() as c:
        t = time.perf_counter()
        events = await c.responses.create(
            model="sam-3.1",
            input=[
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": prompt},
                        {"type": "input_video", "video_url": data_url(video)},
                    ],
                }
            ],
            stream=True,
            metadata={"mask_encoding": "one_bit"},
        )
        parsed = parse_responses_stream(events, video_segmentation_format())
        first = None
        async with parsed:
            async for snapshot in parsed:
                if first is None and snapshot.records:
                    first = time.perf_counter() - t
            result = await parsed.final_result()
        total = time.perf_counter() - t

    print(f"[sam] first records after {first}s, total {total:.1f}s")
    print("outcome:", result.outcome, "diagnostics:", result.diagnostics)
    boxes = [r for r in result.records if isinstance(r, SegmentationBoxRecord)]
    masks = [r for r in result.records if isinstance(r, SegmentationMaskRecord)]
    frames = sorted({r.frame.frame_index for r in boxes if r.frame is not None})
    ids = sorted({r.object_id for r in boxes})
    print(f"boxes={len(boxes)} masks={len(masks)} frames={len(frames)} object_ids={ids}")
    print("frame range:", frames[:3], "...", frames[-3:])
    for r in boxes[:3]:
        print(r)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("what", nargs="?", default="all", choices=["spark", "transcribe", "sam", "all"])
    ap.add_argument("--video", type=Path, default=PROBE_DIR / "testsrc.mp4")
    ap.add_argument("--prompt", default="person")
    ap.add_argument("--mode", default="ENDPOINTING", choices=["ENDPOINTING", "PUSH_TO_TALK", "DIARIZATION"])
    args = ap.parse_args()

    if args.what in ("spark", "all"):
        await probe_spark()
    if args.what in ("transcribe", "all"):
        await probe_transcribe(args.mode)
    if args.what in ("sam", "all"):
        await probe_sam(args.video, args.prompt)


if __name__ == "__main__":
    asyncio.run(main())
