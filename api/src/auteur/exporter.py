"""Exports from the Export dialog: an MP4 at a chosen size, quality and frame rate, a GIF, or the
soundtrack alone as MP3.

An export renders a snapshot of the timeline taken when it starts, so editing can go on meanwhile. It
runs in the background, reports progress on the project's event stream and can be cancelled (ffmpeg
is killed). One export per project at a time.
"""

import asyncio
import subprocess
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from auteur.render import Encode, RenderCancelled, RenderError, render
from auteur.timeline.models import Media, Timeline
from auteur.tracking import Track

Format = Literal["mp4", "gif", "mp3"]
Quality = Literal["draft", "standard", "high"]

# crf, x264 preset, audio bitrate
QUALITY: dict[str, tuple[int, str, str]] = {
    "draft": (28, "veryfast", "128k"),
    "standard": (21, "medium", "160k"),
    "high": (17, "slow", "256k"),
}
GIF_FPS = 15
GIF_MAX_SECONDS = 60
GIF_MAX_HEIGHT = 720


class ExportView(BaseModel):
    id: str
    format: Format
    resolution: int
    quality: Quality
    fps: float
    mbps: float | None = None
    status: Literal["running", "done", "failed", "cancelled"]
    progress: float
    url: str | None = None
    error: str | None = None


@dataclass
class ExportJob:
    id: str
    project_id: str
    format: Format
    resolution: int
    quality: Quality
    fps: float
    mbps: float | None = None  # target video bitrate; None = the quality preset
    status: str = "running"
    progress: float = 0.0
    file: str | None = None  # relative to the project dir
    error: str | None = None
    cancel: threading.Event = field(default_factory=threading.Event)

    def view(self) -> ExportView:
        return ExportView(
            id=self.id, format=self.format, resolution=self.resolution, quality=self.quality, fps=self.fps, mbps=self.mbps,
            status=self.status, progress=round(self.progress, 3), error=self.error,  # type: ignore[arg-type]
            url=f"/files/{self.project_id}/{self.file}" if self.file and self.status == "done" else None,
        )


def scale_for(tl: Timeline, resolution: int) -> float:
    """Scale that makes the frame's short side `resolution` pixels (1080 = the timeline's own size)."""
    return resolution / min(tl.size)


def export_file(project_dir: Path, job: ExportJob) -> Path:
    exports = project_dir / "exports"
    exports.mkdir(parents=True, exist_ok=True)
    n = len(list(exports.iterdir())) + 1
    return exports / f"export-{n}-{job.resolution}p.{job.format}" if job.format != "mp3" else exports / f"export-{n}.mp3"


def _gif(src: Path, out: Path, cancel: threading.Event) -> None:
    """Two-pass GIF with a palette made for this clip (much cleaner than ffmpeg's default palette)."""
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-vf",
         f"fps={GIF_FPS},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
         "-loop", "0", str(out)],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
    )
    while proc.poll() is None:
        if cancel.wait(0.2):
            proc.kill()
            proc.wait()
            out.unlink(missing_ok=True)
            raise RenderCancelled("Cancelled")
    if proc.returncode != 0:
        raise RenderError((proc.stderr.read() if proc.stderr else "")[-800:] or "GIF encoding failed")


def run_export(
    job: ExportJob, tl: Timeline, media: dict[str, Media], tracks: dict[str, Track], project_dir: Path,
    on_progress: Callable[[], None],
) -> None:
    """Render the export synchronously (call it in a thread); updates `job` as it goes."""
    tl = tl.model_copy(update={"fps": job.fps})
    crf, preset, abr = QUALITY[job.quality]
    out = export_file(project_dir, job)

    def progress(share: float, offset: float = 0.0) -> Callable[[float], None]:
        def report(p: float) -> None:
            value = offset + p * share
            if value - job.progress >= 0.01 or p >= 1:
                job.progress = min(value, 0.999)
                on_progress()
        return report

    if job.format == "mp3":
        render(tl, media, out, 0.25, progress(1.0), tracks, Encode(audio_bitrate=abr, audio_only=True), job.cancel)
    elif job.format == "gif":
        tmp = out.with_suffix(".tmp.mp4")
        try:
            render(tl, media, tmp, scale_for(tl, job.resolution), progress(0.8), tracks,
                   Encode(crf=18, preset="veryfast"), job.cancel)
            _gif(tmp, out, job.cancel)
        finally:
            tmp.unlink(missing_ok=True)
    else:
        render(tl, media, out, scale_for(tl, job.resolution), progress(1.0), tracks,
               Encode(crf=crf, preset=preset, audio_bitrate=abr, video_mbps=job.mbps), job.cancel)
    job.file = str(out.relative_to(project_dir))


async def start(
    job: ExportJob, tl: Timeline, media: dict[str, Media], tracks: dict[str, Track], project_dir: Path,
    publish: Callable[[ExportView], None], on_done: Callable[[ExportJob], None],
) -> None:
    """Run an export to the end, publishing its state on every change."""
    loop = asyncio.get_running_loop()
    publish(job.view())
    try:
        # Progress comes from the render thread; the event bus belongs to the event loop.
        from_thread = lambda: loop.call_soon_threadsafe(publish, job.view())  # noqa: E731
        await asyncio.to_thread(run_export, job, tl, media, tracks, project_dir, from_thread)
        job.status, job.progress = "done", 1.0
        on_done(job)
    except RenderCancelled:
        job.status = "cancelled"
    except (RenderError, OSError) as e:
        job.status, job.error = "failed", str(e)[-400:]
    except Exception as e:  # never leave an export spinning forever
        job.status, job.error = "failed", f"Something went wrong: {e}"
    publish(job.view())
