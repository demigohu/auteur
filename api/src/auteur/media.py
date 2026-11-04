"""Media ingest: probe the upload with ffprobe and derive the files the rest of the app uses.

Layout per media item, under <project_dir>/media/<media_id>/:
  source.<ext>  the original upload, used for the final render
  preview.mp4   720p H.264 with a keyframe every 0.5s, so the browser player seeks instantly
  thumb.jpg     media bin thumbnail
  filmstrip.jpg one 90px-high frame per second, side by side, for the timeline's clip blocks
  sam.mp4       15fps 640px silent proxy for SAM 3.1 (made on demand; full-res uploads get the
                connection reset by the API)

Pictures become video at ingest, so the timeline, preview, effects and export need no special case:
a still (PNG, JPG, WebP) is held for STILL_SECONDS, a GIF is looped to at least GIF_MIN_SECONDS. The
upload is kept as original.<ext>.
"""

import json
import math
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageOps

from auteur.timeline import Media

STILL_SECONDS = 60
GIF_MIN_SECONDS = 5
STILL_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
MAX_PICTURE_SIDE = 3840


class MediaError(ValueError):
    pass


def _run(args: list[str]) -> str:
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise MediaError(proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else "ffmpeg failed")
    return proc.stdout


CREATION_TAGS = ("com.apple.quicktime.creationdate", "creation_time", "date")


def probe(path: Path) -> dict:
    out = _run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration:format_tags:stream=codec_type,width,height,avg_frame_rate,disposition:"
        "stream_tags:stream_side_data=rotation",
        "-of", "json", str(path),
    ])
    info = json.loads(out)
    streams = info.get("streams", [])
    tags = {**{k: v for s in streams for k, v in s.get("tags", {}).items()}, **info["format"].get("tags", {})}
    recorded_at = next((tags[k] for k in CREATION_TAGS if k in tags), None)
    # Cover art in an MP3 shows up as a "video" stream; it is not footage.
    video = next(
        (s for s in streams if s["codec_type"] == "video" and not s.get("disposition", {}).get("attached_pic")), None
    )
    has_audio = any(s["codec_type"] == "audio" for s in streams)
    if video is None:
        if not has_audio:
            raise MediaError("File has no video or audio stream")
        return {
            "duration": round(float(info["format"]["duration"]), 3), "fps": 0.0, "width": 0, "height": 0,
            "has_audio": True, "kind": "audio", "recorded_at": None,
        }
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
        "has_audio": has_audio,
        "kind": "video",
        "recorded_at": recorded_at,
    }


def media_dir(project_dir: Path, media_id: str) -> Path:
    return project_dir / "media" / media_id


def _still_to_video(original: Path, out: Path) -> None:
    """Hold a picture for STILL_SECONDS. Pillow first: it applies EXIF rotation and flattens
    transparency (onto black), which ffmpeg does inconsistently for images."""
    with Image.open(original) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            flat = Image.new("RGB", im.size, (0, 0, 0))
            flat.paste(im, mask=im.getchannel("A"))
            im = flat
        im = im.convert("RGB")
        im.thumbnail((MAX_PICTURE_SIDE, MAX_PICTURE_SIDE))
        with tempfile.TemporaryDirectory() as tmp:
            png = Path(tmp) / "still.png"
            im.save(png)
            _run([
                "ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-framerate", "30", "-t", str(STILL_SECONDS),
                "-i", str(png), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
                "-c:v", "libx264", "-tune", "stillimage", "-preset", "veryfast", "-crf", "16", "-movflags", "+faststart",
                str(out),
            ])


def _gif_to_video(original: Path, out: Path) -> None:
    """An animated GIF as video, looped whole until it lasts at least GIF_MIN_SECONDS."""
    length = float(_run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(original)]) or 0)
    loops = max(1, math.ceil(GIF_MIN_SECONDS / length)) if length > 0 else 1
    _run([
        "ffmpeg", "-y", "-loglevel", "error", "-stream_loop", str(loops - 1), "-i", str(original),
        "-vf", f"scale='min({MAX_PICTURE_SIDE},iw)':-2,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", "-movflags", "+faststart", str(out),
    ])


def _move(src: Path, dst: Path) -> None:
    """Rename when possible, copy then delete across filesystems: in Docker the data directory is its own
    volume, so a file made in /tmp (a generated picture, a freeze frame) can't simply be renamed into it."""
    shutil.move(src, dst)


def ingest(project_dir: Path, media_id: str, name: str, upload: Path) -> Media:
    """Move an uploaded file into place, then build its preview and thumbnail."""
    d = media_dir(project_dir, media_id)
    d.mkdir(parents=True, exist_ok=True)
    suffix = upload.suffix.lower() or ".mp4"
    image: str | None = None
    if suffix in STILL_SUFFIXES or suffix == ".gif":
        original = d / f"original{suffix}"
        _move(upload, original)
        source = d / "source.mp4"
        try:
            if suffix == ".gif":
                _gif_to_video(original, source)
                image = "gif"
            else:
                _still_to_video(original, source)
                image = "still"
        except (OSError, ValueError) as e:
            raise MediaError(f"Could not read the picture: {e}") from None
    else:
        source = d / f"source{suffix}"
        _move(upload, source)
    info = probe(source)
    if info["kind"] == "audio":
        return _ingest_audio(d, media_id, name, source, info)

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
    if info["has_audio"]:
        make_waveform(source, d / "waveform.png", info["duration"])
    return Media(id=media_id, name=name, path=str(source), image=image, **info)


def make_waveform(source: Path, out: Path, duration: float) -> None:
    """The sound as a picture for timeline blocks: about 40 px per second, 90 px high."""
    width = max(200, min(4000, round(duration * 40)))
    _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(source), "-filter_complex",
          f"aformat=channel_layouts=mono,showwavespic=s={width}x90:colors=#eea53f", "-frames:v", "1", str(out)])


def _ingest_audio(d: Path, media_id: str, name: str, source: Path, info: dict) -> Media:
    """Music: a browser-friendly copy, a waveform picture for the timeline, and its beats."""
    from auteur.beats import analyze

    _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(source), "-vn", "-c:a", "aac", "-b:a", "160k",
          "-movflags", "+faststart", str(d / "preview.m4a")])
    make_waveform(source, d / "filmstrip.png", info["duration"])
    (d / "beats.json").write_text(analyze(source).model_dump_json())
    return Media(id=media_id, name=name, path=str(source), **info)


def load_beats(project_dir: Path, media_id: str):
    from auteur.beats import Beats, analyze

    f = media_dir(project_dir, media_id) / "beats.json"
    if not f.exists():
        source = next(media_dir(project_dir, media_id).glob("source.*"))
        f.write_text(analyze(source).model_dump_json())
    return Beats.model_validate_json(f.read_text())


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
