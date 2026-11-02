import os
import subprocess
import tempfile
from pathlib import Path

import pytest

# Settings are read at import time, so point the data dir somewhere disposable before anything imports auteur.main.
os.environ["AUTEUR_DATA_DIR"] = tempfile.mkdtemp(prefix="auteur-test-")


@pytest.fixture(scope="session")
def sample_video(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """4s 1280x720 30fps clip with a tone, rendered once per test session."""
    out = tmp_path_factory.mktemp("media") / "sample.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=4",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out),
        ],
        check=True,
    )
    return out
