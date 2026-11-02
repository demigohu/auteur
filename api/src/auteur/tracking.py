"""Object tracking with SAM 3.1, built around what the API tests showed (see docs/PRD.md):

- SAM gets the 15fps 640px proxy, never the original upload (full-res uploads reset the connection).
- The 16 object IDs are per request, not per frame: in a crowd they run out on passers-by and later
  subjects are never tracked. So the proxy is cut into 5s segments (10s still ran out of IDs in a
  crowded opening), tracked in parallel, and IDs are stitched across boundaries by box overlap.

Boxes are stored in proxy pixels; consumers normalize by the track's width/height.
"""

import asyncio
import json
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

from meta_sam_parser import (
    CompletedOutcome,
    SegmentationBoxRecord,
    parse_responses_stream,
    video_segmentation_format,
)
from openai import AsyncOpenAI

from auteur.config import settings
from auteur.media import probe, sam_proxy
from auteur.timeline.models import Model

SAM_FPS = 15
SEGMENT_SECONDS = 5
PARALLEL = 6
LINK_IOU = 0.3

Box = tuple[int, int, int, int]  # x1, y1, x2, y2 in proxy pixels


class Track(Model):
    id: str
    media_id: str
    prompt: str
    fps: float
    width: int
    height: int
    total_frames: int
    objects: dict[str, dict[int, Box]]  # object id -> frame index -> box

    def frames(self, object_id: str) -> dict[int, Box]:
        return self.objects.get(object_id, {})

    def box_at(self, object_id: str, t: float, hold: float = 0.5) -> Box | None:
        """Box at source time t, interpolated between detections up to `hold` seconds apart."""
        frames = self.frames(object_id)
        if not frames:
            return None
        f = t * self.fps
        before = max((k for k in frames if k <= f), default=None)
        after = min((k for k in frames if k >= f), default=None)
        if before is None or after is None:
            near = before if before is not None else after
            return frames[near] if abs(near - f) <= hold * self.fps else None
        if before == after:
            return frames[before]
        if (after - before) > 2 * hold * self.fps:
            return None
        k = (f - before) / (after - before)
        a, b = frames[before], frames[after]
        return tuple(round(a[i] + (b[i] - a[i]) * k) for i in range(4))  # type: ignore[return-value]

    def summary(self, limit: int = 8) -> list[dict]:
        """Objects ranked by presence x size: the likely main subject comes first."""
        total = max(1, self.total_frames)
        rows = []
        for oid, frames in self.objects.items():
            areas = [(b[2] - b[0]) * (b[3] - b[1]) for b in frames.values()]
            cx = sum((b[0] + b[2]) / 2 for b in frames.values()) / len(frames) / self.width
            rows.append({
                "object_id": oid,
                "seconds": f"{min(frames) / self.fps:.1f}-{max(frames) / self.fps:.1f}",
                "coverage": round(len(frames) / total, 2),
                "avg_size": round(sum(areas) / len(areas) / (self.width * self.height), 3),
                "avg_x": round(cx, 2),
                "score": len(frames) * sum(areas) / len(areas),
            })
        rows.sort(key=lambda r: -r["score"])
        for r in rows:
            del r["score"]
        return rows[:limit]

    def main_object(self) -> str | None:
        ranked = self.summary(limit=1)
        return ranked[0]["object_id"] if ranked else None


def iou(a: Box, b: Box) -> float:
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union else 0.0


async def _track_segment(client: AsyncOpenAI, video: Path, prompt: str) -> dict[str, dict[int, Box]]:
    import base64

    url = "data:video/mp4;base64," + base64.b64encode(video.read_bytes()).decode()
    events = await client.responses.create(
        model="sam-3.1",
        input=[{"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": prompt},
            {"type": "input_video", "video_url": url},
        ]}],
        stream=True,
        metadata={"mask_encoding": "one_bit"},
    )
    result = await parse_responses_stream(events, video_segmentation_format()).final_result()
    if not isinstance(result.outcome, CompletedOutcome):
        raise RuntimeError(f"SAM did not complete: {result.outcome}")
    objects: dict[str, dict[int, Box]] = {}
    for r in result.records:
        if isinstance(r, SegmentationBoxRecord) and r.frame is not None:
            objects.setdefault(r.object_id, {})[r.frame.frame_index] = (r.left, r.top, r.right, r.bottom)
    return objects


def stitch(segments: list[dict[str, dict[int, Box]]], frames_per_segment: int) -> dict[str, dict[int, Box]]:
    """Merge per-segment objects into global ids, linking an object to the one it continues."""
    merged: dict[str, dict[int, Box]] = {}
    previous: dict[str, str] = {}  # local id in previous segment -> global id
    next_id = 0
    for k, seg in enumerate(segments):
        offset = k * frames_per_segment
        current: dict[str, str] = {}
        taken: set[str] = set()
        # Link local objects that start at the segment's first frames to objects alive at the end of the last one.
        for local, frames in sorted(seg.items(), key=lambda kv: min(kv[1])):
            first = min(frames)
            best, best_iou = None, LINK_IOU
            if first <= 2:
                for prev_local, gid in previous.items():
                    if gid in taken:
                        continue
                    last_frames = merged[gid]
                    last = max(last_frames)
                    if last < offset - 3:
                        continue
                    score = iou(last_frames[last], frames[first])
                    if score > best_iou:
                        best, best_iou = gid, score
            gid = best if best is not None else str(next_id)
            if best is None:
                next_id += 1
            taken.add(gid)
            current[local] = gid
            merged.setdefault(gid, {}).update({offset + f: b for f, b in frames.items()})
        previous = current
    return merged


async def track_media(
    project_dir: Path, media_id: str, track_id: str, prompt: str,
    on_progress: Callable[[float], None] | None = None,
) -> Track:
    proxy = await asyncio.to_thread(sam_proxy, project_dir, media_id)
    info = await asyncio.to_thread(probe, proxy)
    count = max(1, int(-(-info["duration"] // SEGMENT_SECONDS)))
    client = AsyncOpenAI(api_key=settings.meta_api_key, base_url=settings.meta_base_url)
    gate = asyncio.Semaphore(PARALLEL)
    done = 0

    with tempfile.TemporaryDirectory() as tmp:
        async def run(k: int) -> dict[str, dict[int, Box]]:
            nonlocal done
            seg = Path(tmp) / f"seg{k}.mp4"
            # Re-encode so every segment starts on exactly frame k*150 of the proxy.
            await asyncio.to_thread(subprocess.run, [
                "ffmpeg", "-y", "-loglevel", "error", "-i", str(proxy),
                "-vf", f"select='between(n\\,{k * SEGMENT_SECONDS * SAM_FPS}\\,{(k + 1) * SEGMENT_SECONDS * SAM_FPS - 1})',setpts=N/{SAM_FPS}/TB",
                "-r", str(SAM_FPS), "-c:v", "libx264", "-crf", "26", "-pix_fmt", "yuv420p", str(seg),
            ], check=True)
            async with gate:
                for attempt in range(2):
                    try:
                        objects = await _track_segment(client, seg, prompt)
                        break
                    except Exception:
                        if attempt:
                            raise
            done += 1
            if on_progress:
                on_progress(done / count)
            return objects

        segments = await asyncio.gather(*(run(k) for k in range(count)))

    track = Track(
        id=track_id, media_id=media_id, prompt=prompt, fps=SAM_FPS,
        width=info["width"], height=info["height"], total_frames=round(info["duration"] * SAM_FPS),
        objects=stitch(segments, SEGMENT_SECONDS * SAM_FPS),
    )
    out = project_dir / "tracks" / f"{track_id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(track.model_dump_json())
    return track


def load_track(project_dir: Path, track_id: str) -> Track:
    return Track.model_validate_json((project_dir / "tracks" / f"{track_id}.json").read_text())


def frames_json(track: Track) -> str:
    """Compact form for the browser overlay: normalized boxes per object per frame."""
    return json.dumps({
        "fps": track.fps,
        "objects": {
            oid: {f: [round(b[0] / track.width, 4), round(b[1] / track.height, 4),
                      round(b[2] / track.width, 4), round(b[3] / track.height, 4)] for f, b in frames.items()}
            for oid, frames in track.objects.items()
        },
    })
