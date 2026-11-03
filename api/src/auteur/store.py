"""Persistence: one SQLite row per project holding the Project JSON (timeline + history), and the
accounts that own them. Accounts live in Clerk; this only remembers which Clerk user ids it has seen."""

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
        with self._db:
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, data TEXT, updated_at TEXT)"
            )
            if "owner_id" not in {r[1] for r in self._db.execute("PRAGMA table_info(projects)")}:
                self._db.execute("ALTER TABLE projects ADD COLUMN owner_id TEXT")
            self._db.execute("CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, first_seen TEXT)")
            # Before Clerk, accounts and sessions were stored here. Their projects become unowned, so the
            # first Clerk account picks them up (see `seen`).
            tables = {r[0] for r in self._db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            if "users" in tables:
                self._db.execute("UPDATE projects SET owner_id = NULL WHERE owner_id IN (SELECT id FROM users)")
                self._db.execute("DROP TABLE users")
            if "sessions" in tables:
                self._db.execute("DROP TABLE sessions")

    def project_dir(self, project_id: str) -> Path:
        return self.data_dir / "projects" / project_id

    def create(self, name: str, owner_id: str | None = None) -> Project:
        p = Project(id=new_id("proj"), name=name)
        self.save(p)
        if owner_id:
            with self._lock, self._db:
                self._db.execute("UPDATE projects SET owner_id = ? WHERE id = ?", (owner_id, p.id))
        return p

    def owner(self, project_id: str) -> str | None:
        with self._lock:
            row = self._db.execute("SELECT owner_id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            raise NotFound(project_id)
        return row[0]

    def delete(self, project_id: str) -> None:
        with self._lock, self._db:
            self._db.execute("DELETE FROM projects WHERE id = ?", (project_id,))

    def get(self, project_id: str) -> Project:
        with self._lock:
            row = self._db.execute("SELECT data FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            raise NotFound(project_id)
        return Project.model_validate_json(row[0])

    def save(self, p: Project) -> None:
        with self._lock, self._db:
            # Upsert rather than INSERT OR REPLACE, which would drop the owner column.
            self._db.execute(
                "INSERT INTO projects (id, name, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE"
                " SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at",
                (p.id, p.name, p.model_dump_json(), datetime.now(UTC).isoformat()),
            )

    def spent_by(self, owner_id: str) -> float:
        with self._lock:
            rows = self._db.execute("SELECT json_extract(data, '$.spent') FROM projects WHERE owner_id = ?", (owner_id,)).fetchall()
        return sum(r[0] or 0 for r in rows)

    def total_spent(self) -> float:
        with self._lock:
            rows = self._db.execute("SELECT json_extract(data, '$.spent') FROM projects").fetchall()
        return sum(r[0] or 0 for r in rows)

    def list(self, owner_id: str) -> list[tuple[Project, str]]:
        """The owner's projects, most recently edited first, with their last-edit time."""
        with self._lock:
            rows = self._db.execute(
                "SELECT data, updated_at FROM projects WHERE owner_id = ? ORDER BY updated_at DESC", (owner_id,)
            ).fetchall()
        return [(Project.model_validate_json(r[0]), r[1]) for r in rows]

    # Accounts

    def seen(self, account_id: str) -> None:
        """Record a Clerk user the first time it makes a request. The very first account adopts projects
        that have no owner, so a local install keeps its work."""
        with self._lock, self._db:
            if self._db.execute("SELECT 1 FROM accounts WHERE id = ?", (account_id,)).fetchone():
                return
            first = self._db.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0
            self._db.execute("INSERT INTO accounts (id, first_seen) VALUES (?, ?)", (account_id, datetime.now(UTC).isoformat()))
            if first:
                self._db.execute("UPDATE projects SET owner_id = ? WHERE owner_id IS NULL", (account_id,))
