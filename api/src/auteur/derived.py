"""Files derived from media for clip settings the browser can't draw itself: playing backwards and LUTs.

A reversed copy of a whole media file is made once (in short chunks, so memory stays flat, then joined
in reverse order); a reversed clip trims it at mirrored times, so trims and splits keep working. A LUT's
intensity is blended into the table itself (identity + intensity * (lut - identity)), so the export
needs a single lut3d filter. The editor previews these through 720p variants of preview.mp4 with the
same processing baked in, made in the background (variant_name / make_variant).
"""

import hashlib
import math
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from auteur.timeline.models import AudioItem, Clip, Media

CHUNK_SECONDS = 2.0
MAX_LUT_SIZE = 65


class DerivedError(ValueError):
    pass


def _run(args: list[str]) -> None:
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise DerivedError((proc.stderr.strip().splitlines() or ["ffmpeg failed"])[-1])


# --- reverse -------------------------------------------------------------------------------------------

def reverse_file(src: Path, out: Path, duration: float, has_audio: bool, preview: bool = False) -> Path:
    """`src` played backwards, made chunk by chunk (ffmpeg's reverse filter holds every frame in memory)."""
    if out.exists():
        return out
    n = max(1, math.ceil(duration / CHUNK_SECONDS - 1e-6))
    enc = (["-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-g", "15", "-keyint_min", "15", "-sc_threshold", "0"]
           if preview else ["-c:v", "libx264", "-preset", "veryfast", "-crf", "16"])
    with tempfile.TemporaryDirectory(dir=out.parent) as tmp:
        parts = []
        for k in range(n):
            start = k * CHUNK_SECONDS
            part = Path(tmp) / f"part{k:04d}.mp4"
            _run([
                "ffmpeg", "-y", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{min(CHUNK_SECONDS, duration - start):.3f}",
                "-i", str(src), "-vf", "reverse", *(["-af", "areverse", "-c:a", "aac", "-b:a", "160k"] if has_audio else ["-an"]),
                *enc, "-pix_fmt", "yuv420p", str(part),
            ])
            parts.append(part)
        listing = Path(tmp) / "parts.txt"
        listing.write_text("".join(f"file '{p}'\n" for p in reversed(parts)))
        partial = out.with_suffix(".partial.mp4")
        _run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy",
              "-movflags", "+faststart", str(partial)])
        partial.replace(out)
    return out


def reversed_source(media_dir: Path, m: Media) -> Path:
    return reverse_file(Path(m.path), media_dir / "reverse.mp4", m.duration, m.has_audio)


def mirrored(c: Clip, m: Media) -> tuple[float, float]:
    """The clip's source range in the reversed file."""
    return round(m.duration - c.src_out, 3), round(m.duration - c.src_in, 3)


# --- LUTs ------------------------------------------------------------------------------------------------

def parse_cube(text: str) -> tuple[int, np.ndarray]:
    """A .cube 3D LUT as (size, table of size^3 x 3 in file order: red fastest). Raises DerivedError."""
    size, rows, lo, hi = None, [], [0.0, 0.0, 0.0], [1.0, 1.0, 1.0]
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line or line.startswith("TITLE"):
            continue
        key, *rest = line.split()
        if key == "LUT_3D_SIZE":
            size = int(rest[0])
        elif key == "LUT_1D_SIZE":
            raise DerivedError("1D LUTs aren't supported; use a 3D .cube")
        elif key == "DOMAIN_MIN":
            lo = [float(v) for v in rest]
        elif key == "DOMAIN_MAX":
            hi = [float(v) for v in rest]
        else:
            try:
                rows.append([float(key), *map(float, rest)])
            except ValueError:
                raise DerivedError(f"Unexpected line in the LUT: {line[:40]!r}") from None
    if not size or not 2 <= size <= MAX_LUT_SIZE:
        raise DerivedError(f"LUT_3D_SIZE must be 2-{MAX_LUT_SIZE}")
    table = np.array(rows, dtype=np.float64)
    if table.shape != (size**3, 3):
        raise DerivedError(f"Expected {size**3} RGB rows for a size-{size} LUT, found {len(rows)}")
    if lo != [0.0, 0.0, 0.0] or hi != [1.0, 1.0, 1.0]:
        table = (table - np.array(lo)) / (np.array(hi) - np.array(lo))
    return size, np.clip(table, 0, 1)


def identity(size: int) -> np.ndarray:
    v = np.arange(size) / (size - 1)
    b, g, r = np.meshgrid(v, v, v, indexing="ij")  # red changes fastest in .cube order
    return np.stack([r.ravel(), g.ravel(), b.ravel()], axis=1)


def write_cube(size: int, table: np.ndarray, out: Path) -> Path:
    lines = [f"LUT_3D_SIZE {size}"] + [f"{r:.6f} {g:.6f} {b:.6f}" for r, g, b in table]
    out.write_text("\n".join(lines) + "\n")
    return out


def scaled_lut(lut: Path, intensity: float, out: Path) -> Path:
    """The LUT at `intensity` (0 = no change, 1 = full), as a new .cube."""
    size, table = parse_cube(lut.read_text())
    return write_cube(size, identity(size) + intensity * (table - identity(size)), out)


# --- audio cleaning ------------------------------------------------------------------------------

def audio_clean_filters(clean) -> list[str]:
    """ffmpeg audio filters for AudioClean; the export and the editor's variant use the same ones."""
    if not clean or not clean.active:
        return []
    f = []
    if clean.voice:
        f.append("highpass=f=80")
    if clean.denoise > 0:
        # Measured on a tone in white noise: hiss above 2 kHz drops 9-17 dB, the tone stays within 0.2 dB.
        f.append(f"afftdn=nr={6 + 24 * clean.denoise:.1f}:nf=-40:tn=1")
    if clean.voice:
        f += ["equalizer=f=3000:t=q:w=1:g=3", "acompressor=threshold=0.12:ratio=3:attack=10:release=200:makeup=1.5"]
    return f


# --- chroma key ---------------------------------------------------------------------------------------

def chroma_filters(chroma) -> list[str]:
    """Key out the screen color (alpha); the export and the editor's WebM variant use the same filter."""
    if not chroma:
        return []
    return ["format=yuva420p", f"chromakey=color=0x{chroma.color[1:]}:similarity={chroma.similarity:.3f}:blend={chroma.blend:.3f}"]


def overlay_variant_name(o) -> str | None:
    if not o.chroma:
        return None
    key = f"chroma:{o.chroma.color}:{o.chroma.similarity:.3f}:{o.chroma.blend:.3f}"
    return f"keyed-{hashlib.sha1(key.encode()).hexdigest()[:12]}.webm"


def make_overlay_variant(media_dir: Path, o) -> Path:
    """preview.mp4 keyed, as VP9 WebM with alpha (browsers play its transparency)."""
    out = media_dir / overlay_variant_name(o)
    if out.exists():
        return out
    partial = out.with_suffix(".partial.webm")
    _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(media_dir / "preview.mp4"), "-vf", ",".join(chroma_filters(o.chroma)),
          "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "0", "-crf", "32",
          "-an", str(partial)])
    partial.replace(out)
    return out


# --- editor previews ----------------------------------------------------------------------------------

def variant_name(c: Clip) -> str | None:
    """File name of the preview variant a clip needs, or None when plain preview.mp4 will do."""
    clean = audio_clean_filters(c.audio_clean)
    if not c.reverse and not c.lut and not clean and not c.bg_remove:
        return None
    bg = c.bg_remove.model_dump_json() if c.bg_remove else ""
    key = f"{bg}:r{int(c.reverse)}:{c.lut.lut_id if c.lut else ''}:{round(c.lut.intensity, 2) if c.lut else ''}:{','.join(clean)}"
    return f"variant-{hashlib.sha1(key.encode()).hexdigest()[:12]}.mp4"


def make_variant(media_dir: Path, m: Media, c: Clip, lut_dir: Path) -> Path:
    """preview.mp4 reversed and/or with the clip's LUT baked in (grades still apply on top)."""
    name = variant_name(c)
    assert name is not None
    out = media_dir / name
    if out.exists():
        return out
    src = media_dir / "preview.mp4"
    if c.bg_remove:
        src = _bg_removed_preview(media_dir, src, c)
    if c.reverse:
        src = reverse_file(src, media_dir / "preview-reverse.mp4", m.duration, m.has_audio, preview=True)
    clean = audio_clean_filters(c.audio_clean) if m.has_audio else []
    if not c.lut and not clean:
        if c.bg_remove:
            # The editor asks for the variant by name (preview_name); only reverse alone has its own.
            shutil.copyfile(src, out)
            return out
        return src
    if not c.lut:
        # Only the sound changes: copy the picture, clean the audio.
        partial = out.with_suffix(".partial.mp4")
        _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-c:v", "copy", "-af", ",".join(clean),
              "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(partial)])
        partial.replace(out)
        return out
    with tempfile.TemporaryDirectory(dir=media_dir) as tmp:
        cube = scaled_lut(lut_dir / f"{c.lut.lut_id}.cube", c.lut.intensity, Path(tmp) / "lut.cube")
        partial = out.with_suffix(".partial.mp4")
        _run([
            "ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-vf", f"lut3d=file='{cube}'",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-g", "15", "-keyint_min", "15", "-sc_threshold", "0",
            "-pix_fmt", "yuv420p", *(["-af", ",".join(clean), "-c:a", "aac", "-b:a", "128k"] if clean else ["-c:a", "copy"]),
            "-movflags", "+faststart", str(partial),
        ])
        partial.replace(out)
    return out


def audio_variant_name(a: AudioItem) -> str | None:
    """The cleaned-sound preview of a music-track item, or None when preview.m4a will do."""
    clean = audio_clean_filters(a.audio_clean)
    return f"clean-{hashlib.sha1(','.join(clean).encode()).hexdigest()[:12]}.m4a" if clean else None


def make_audio_variant(media_dir: Path, preview: Path, a: AudioItem) -> Path:
    """The item's media preview (whole file, so trims still line up) with its sound cleaned."""
    out = media_dir / audio_variant_name(a)
    if not out.exists():
        partial = out.with_suffix(".partial.m4a")
        _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(preview), "-vn", "-af", ",".join(audio_clean_filters(a.audio_clean)),
              "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(partial)])
        partial.replace(out)
    return out


def _bg_removed_preview(media_dir: Path, preview: Path, c: Clip) -> Path:
    """preview.mp4 with the background replaced, the same way render.py does it at full size."""
    from auteur.masks import mask_name  # noqa: PLC0415

    out = media_dir / f"bg-{hashlib.sha1(c.bg_remove.model_dump_json().encode()).hexdigest()[:12]}.mp4"
    if out.exists():
        return out
    mask = media_dir / mask_name(c.bg_remove.prompt, c.bg_remove.keep)
    if not mask.exists():
        raise DerivedError("No background mask yet")
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height,r_frame_rate",
                            "-of", "csv=p=0", str(preview)], capture_output=True, text=True).stdout.strip().split(",")
    w, h, rate = int(probe[0]), int(probe[1]), probe[2]
    bd = c.bg_remove.backdrop
    back = f"gblur=sigma={bd.blur * h:.2f}" if bd.kind == "blur" else f"drawbox=c={bd.color}:t=fill"
    graph = (f"[0:v]split[k][b];[1:v]fps={rate},scale={w}:{h},format=gray,gblur=sigma={max(1.0, h / 360):.2f}[mm];"
             f"[k][mm]alphamerge[fg];[b]{back}[bg];[bg][fg]overlay=format=auto,format=yuv420p[v]")
    partial = out.with_suffix(".partial.mp4")
    _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(preview), "-i", str(mask), "-filter_complex", graph,
          "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-g", "15",
          "-keyint_min", "15", "-sc_threshold", "0", "-c:a", "copy", "-shortest", "-movflags", "+faststart", str(partial)])
    partial.replace(out)
    return out


def preview_name(c: Clip) -> str | None:
    """The file the editor plays for this clip, relative to its media dir (None: preview.mp4)."""
    if c.reverse and not c.lut and not c.bg_remove and not audio_clean_filters(c.audio_clean):
        return "preview-reverse.mp4"
    return variant_name(c)
