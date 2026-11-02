"""Persistence: one SQLite row per project holding the Project JSON (timeline + history), plus accounts
and their sessions."""

import hashlib
import hmac
import secrets
import sqlite3
import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from auteur.timeline import Project
from auteur.timeline.ops import new_id


class NotFound(KeyError):
    pass


class EmailTaken(ValueError):
    pass


@dataclass(frozen=True)
class User:
    id: str
    email: str
    name: str


SESSION_DAYS = 30


def _hash_password(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)


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
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT,"
                " salt BLOB, password_hash BLOB, created_at TEXT)"
            )
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT, expires_at TEXT)"
            )

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

    def create_user(self, email: str, name: str, password: str) -> User:
        """New account. The first account adopts projects made before accounts existed, so a local
        install keeps its work."""
        user = User(id=new_id("user"), email=email.strip().lower(), name=name.strip())
        salt = secrets.token_bytes(16)
        with self._lock, self._db:
            try:
                self._db.execute(
                    "INSERT INTO users (id, email, name, salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (user.id, user.email, user.name, salt, _hash_password(password, salt), datetime.now(UTC).isoformat()),
                )
            except sqlite3.IntegrityError:
                raise EmailTaken(user.email) from None
            if self._db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1:
                self._db.execute("UPDATE projects SET owner_id = ? WHERE owner_id IS NULL", (user.id,))
        return user

    def authenticate(self, email: str, password: str) -> User | None:
        with self._lock:
            row = self._db.execute(
                "SELECT id, email, name, salt, password_hash FROM users WHERE email = ?", (email.strip().lower(),)
            ).fetchone()
        if row is None or not hmac.compare_digest(_hash_password(password, row[3]), row[4]):
            return None
        return User(id=row[0], email=row[1], name=row[2])

    def new_session(self, user: User) -> str:
        token = secrets.token_urlsafe(32)
        expires = datetime.now(UTC) + timedelta(days=SESSION_DAYS)
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                (hashlib.sha256(token.encode()).hexdigest(), user.id, expires.isoformat()),
            )
        return token

    def session_user(self, token: str | None) -> User | None:
        if not token:
            return None
        with self._lock:
            row = self._db.execute(
                "SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id"
                " WHERE s.token_hash = ?",
                (hashlib.sha256(token.encode()).hexdigest(),),
            ).fetchone()
        if row is None or datetime.fromisoformat(row[3]) < datetime.now(UTC):
            return None
        return User(id=row[0], email=row[1], name=row[2])

    def end_session(self, token: str) -> None:
        with self._lock, self._db:
            self._db.execute("DELETE FROM sessions WHERE token_hash = ?", (hashlib.sha256(token.encode()).hexdigest(),))
