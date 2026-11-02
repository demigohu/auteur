"""Media ingest: probe the upload with ffprobe and derive the files the rest of the app uses.

Layout per media item, under <project_dir>/media/<media_id>/:
  source.<ext>  the original upload, used for the final render
  preview.mp4   720p H.264 with a keyframe every 0.5s, so the browser player seeks instantly
  thumb.jpg     media bin thumbnail
  filmstrip.jpg one 90px-high frame per second, side by side, for the timeline's clip blocks
  sam.mp4       15fps 640px silent proxy for SAM 3.1 (made on demand; full-res uploads get the
                connection reset by the API)
"""

import json
import math
import subprocess
from pathlib import Path

from auteur.timeline import Media

MAX_TOTAL_SECONDS = 5 * 60


class MediaError(ValueError):
    pass


def _run(args: list[str]) -> str:
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise MediaError(proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else "ffmpeg failed")
    return proc.stdout


def probe(path: Path) -> dict:
    out = _run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,width,height,avg_frame_rate:stream_side_data=rotation",
        "-of", "json", str(path),
    ])
    info = json.loads(out)
    video = next((s for s in info.get("streams", []) if s["codec_type"] == "video"), None)
    if video is None:
        raise MediaError("File has no video stream")
    num, _, den = video["avg_frame_rate"].partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 30.0
    width, height = video["width"], video["height"]
    # Phone footage is often stored landscape with a rotation flag; report the displayed size.
    rotation = next((abs(int(d.get("rotation", 0))) for d in video.get("side_data_list", [])), 0)
    if rotation in (90, 270):
        width, height = height, width
    return {
        "duration": round(float(info["format"]["duration"]), 3),
        "fps": round(fps, 3),
        "width": width,
        "height": height,
        "has_audio": any(s["codec_type"] == "audio" for s in info["streams"]),
    }


def media_dir(project_dir: Path, media_id: str) -> Path:
    return project_dir / "media" / media_id


def ingest(project_dir: Path, media_id: str, name: str, upload: Path) -> Media:
    """Move an uploaded file into place, then build its preview and thumbnail."""
    d = media_dir(project_dir, media_id)
    d.mkdir(parents=True, exist_ok=True)
    source = d / f"source{upload.suffix.lower() or '.mp4'}"
    upload.replace(source)
    info = probe(source)

    _run([
        "ffmpeg", "-y", "-loglevel", "error", "-i", str(source),
        "-vf", "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)'",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
        "-g", "15", "-keyint_min", "15", "-sc_threshold", "0",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
        str(d / "preview.mp4"),
    ])
    # A third of the way in is usually past the "camera still pointing at the floor" opening.
    _run([
        "ffmpeg", "-y", "-loglevel", "error", "-ss", f"{info['duration'] / 3:.3f}", "-i", str(source),
        "-frames:v", "1", "-vf", "scale=320:-2", str(d / "thumb.jpg"),
    ])
    make_filmstrip(source, d / "filmstrip.jpg", info["duration"])
    return Media(id=media_id, name=name, path=str(source), **info)


def make_filmstrip(source: Path, out: Path, duration: float) -> None:
    tiles = max(1, math.ceil(duration))
    _run([
        "ffmpeg", "-y", "-loglevel", "error", "-i", str(source),
        "-vf", f"fps=1,scale=-2:90,tile={tiles}x1", "-frames:v", "1", "-q:v", "5", str(out),
    ])


def sam_proxy(project_dir: Path, media_id: str) -> Path:
    d = media_dir(project_dir, media_id)
    out = d / "sam.mp4"
    if not out.exists():
        source = next(d.glob("source.*"))
        _run([
            "ffmpeg", "-y", "-loglevel", "error", "-i", str(source),
            "-vf", "fps=15,scale='if(gt(iw,ih),640,-2)':'if(gt(iw,ih),-2,640)'", "-an",
            "-c:v", "libx264", "-crf", "26", "-pix_fmt", "yuv420p", str(out),
        ])
    return out
