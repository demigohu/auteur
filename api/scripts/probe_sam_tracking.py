"""Probe SAM 3.1 tracking quality: object ID persistence with a text prompt, then a box prompt on one subject.

Usage: uv run python scripts/probe_sam_tracking.py --video data/probe/clip.mp4 [--prompt person]
"""

import argparse
import asyncio
import json
import time
from collections import defaultdict
from pathlib import Path

from meta_sam_parser import (
    CompletedOutcome,
    FramePrompt,
    PromptBox,
    PromptObject,
    SegmentationBoxRecord,
    build_object_prompt,
    parse_responses_stream,
    video_segmentation_format,
)

from probe_meta import client, data_url, make_proxy


async def track(video: Path, text: str, metadata: dict | None = None) -> tuple[list[SegmentationBoxRecord], float]:
    async with client() as c:
        t = time.perf_counter()
        events = await c.responses.create(
            model="sam-3.1",
            input=[
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": text},
                        {"type": "input_video", "video_url": data_url(video)},
                    ],
                }
            ],
            stream=True,
            metadata={"mask_encoding": "one_bit", **(metadata or {})},
        )
        result = await parse_responses_stream(events, video_segmentation_format()).final_result()
        elapsed = time.perf_counter() - t
    if not isinstance(result.outcome, CompletedOutcome):
        raise RuntimeError(result.outcome)
    boxes = [r for r in result.records if isinstance(r, SegmentationBoxRecord)]
    return boxes, elapsed


def summarize(boxes: list[SegmentationBoxRecord], total_frames: int) -> dict[str, dict]:
    by_id: dict[str, list[SegmentationBoxRecord]] = defaultdict(list)
    for b in boxes:
        by_id[b.object_id].append(b)
    stats = {}
    for oid, recs in by_id.items():
        frames = sorted(r.frame.frame_index for r in recs)
        gaps = sum(1 for a, b in zip(frames, frames[1:]) if b - a > 1)
        area = sum((r.right - r.left) * (r.bottom - r.top) for r in recs) / len(recs)
        stats[oid] = {
            "frames": len(frames),
            "first": frames[0],
            "last": frames[-1],
            "coverage": round(len(frames) / total_frames, 2),
            "gaps": gaps,
            "avg_area": int(area),
        }
    return dict(sorted(stats.items(), key=lambda kv: -kv[1]["frames"] * kv[1]["avg_area"]))


def print_stats(title: str, stats: dict[str, dict]) -> None:
    print(f"\n== {title}")
    print(f"{'id':>4} {'frames':>6} {'first':>5} {'last':>5} {'cov':>5} {'gaps':>4} {'avg_area':>9}")
    for oid, s in stats.items():
        print(f"{oid:>4} {s['frames']:>6} {s['first']:>5} {s['last']:>5} {s['coverage']:>5} {s['gaps']:>4} {s['avg_area']:>9}")


async def main() -> None:
    import subprocess

    ap = argparse.ArgumentParser()
    ap.add_argument("--video", type=Path, required=True)
    ap.add_argument("--prompt", default="person")
    args = ap.parse_args()

    proxy = make_proxy(args.video)
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v",
         "-show_entries", "stream=nb_read_frames,width,height", "-of", "json", str(proxy)],
        capture_output=True, text=True, check=True,
    )
    stream = json.loads(probe.stdout)["streams"][0]
    width, height, total = stream["width"], stream["height"], int(stream["nb_read_frames"])
    print(f"proxy {width}x{height}, {total} frames")

    boxes, elapsed = await track(proxy, args.prompt)
    text_stats = summarize(boxes, total)
    print_stats(f"text prompt '{args.prompt}' ({elapsed:.1f}s, {len(text_stats)} ids)", text_stats)

    # Main subject = most frames x largest area; re-prompt it with its own box on its first frame.
    main_id = next(iter(text_stats))
    first = min((b for b in boxes if b.object_id == main_id), key=lambda b: b.frame.frame_index)
    prompt = build_object_prompt(
        size=(width, height),
        objects=[
            PromptObject(
                id=1,
                prompts=[
                    FramePrompt(
                        frame=first.frame.frame_index,
                        box=PromptBox(first.left, first.top, first.right, first.bottom),
                    )
                ],
            )
        ],
    )
    print(f"\nbox prompt for main subject id={main_id}: {prompt}")
    boxes, elapsed = await track(proxy, prompt, {"propagation_direction": "both"})
    print_stats(f"box prompt ({elapsed:.1f}s)", summarize(boxes, total))


if __name__ == "__main__":
    asyncio.run(main())
