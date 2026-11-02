"""Project persistence: one SQLite row per project holding the Project JSON (timeline + history)."""

import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path

from auteur.timeline import Project
from auteur.timeline.ops import new_id


class NotFound(KeyError):
    pass


class Store:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        data_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(data_dir / "auteur.db", check_same_thread=False)
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, data TEXT, updated_at TEXT)"
        )

    def project_dir(self, project_id: str) -> Path:
        return self.data_dir / "projects" / project_id

    def create(self, name: str) -> Project:
        p = Project(id=new_id("proj"), name=name)
        self.save(p)
        return p

    def get(self, project_id: str) -> Project:
        with self._lock:
            row = self._db.execute("SELECT data FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            raise NotFound(project_id)
        return Project.model_validate_json(row[0])

    def save(self, p: Project) -> None:
        with self._lock, self._db:
            self._db.execute(
                "INSERT OR REPLACE INTO projects (id, name, data, updated_at) VALUES (?, ?, ?, ?)",
                (p.id, p.name, p.model_dump_json(), datetime.now(UTC).isoformat()),
            )

    def list(self) -> list[dict[str, str]]:
        with self._lock:
            rows = self._db.execute("SELECT id, name, updated_at FROM projects ORDER BY updated_at DESC").fetchall()
        return [{"id": r[0], "name": r[1], "updated_at": r[2]} for r in rows]
