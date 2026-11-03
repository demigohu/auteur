"""Files derived from media for clip settings the browser can't draw itself: playing backwards and LUTs.

A reversed copy of a whole media file is made once (in short chunks, so memory stays flat, then joined
in reverse order); a reversed clip trims it at mirrored times, so trims and splits keep working. A LUT's
intensity is blended into the table itself (identity + intensity * (lut - identity)), so the export
needs a single lut3d filter. The editor previews these through 720p variants of preview.mp4 with the
same processing baked in, made in the background (variant_name / make_variant).
"""

import hashlib
import math
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from auteur.timeline.models import Clip, Media

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


# --- editor previews ----------------------------------------------------------------------------------

def variant_name(c: Clip) -> str | None:
    """File name of the preview variant a clip needs, or None when plain preview.mp4 will do."""
    if not c.reverse and not c.lut:
        return None
    key = f"r{int(c.reverse)}:{c.lut.lut_id if c.lut else ''}:{round(c.lut.intensity, 2) if c.lut else ''}"
    return f"variant-{hashlib.sha1(key.encode()).hexdigest()[:12]}.mp4"


def make_variant(media_dir: Path, m: Media, c: Clip, lut_dir: Path) -> Path:
    """preview.mp4 reversed and/or with the clip's LUT baked in (grades still apply on top)."""
    name = variant_name(c)
    assert name is not None
    out = media_dir / name
    if out.exists():
        return out
    src = media_dir / "preview.mp4"
    if c.reverse:
        src = reverse_file(src, media_dir / "preview-reverse.mp4", m.duration, m.has_audio, preview=True)
    if not c.lut:
        return src
    with tempfile.TemporaryDirectory(dir=media_dir) as tmp:
        cube = scaled_lut(lut_dir / f"{c.lut.lut_id}.cube", c.lut.intensity, Path(tmp) / "lut.cube")
        partial = out.with_suffix(".partial.mp4")
        _run([
            "ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-vf", f"lut3d=file='{cube}'",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-g", "15", "-keyint_min", "15", "-sc_threshold", "0",
            "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", str(partial),
        ])
        partial.replace(out)
    return out


def preview_name(c: Clip) -> str | None:
    """The file the editor plays for this clip, relative to its media dir (None: preview.mp4)."""
    if c.reverse and not c.lut:
        return "preview-reverse.mp4"
    return variant_name(c)
