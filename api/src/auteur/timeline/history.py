"""Edit history shared by the agent and the user.

Each commit groups the ops of one action (one user gesture, or one agent tool call) and stores the
timeline before it, so undo is a snapshot restore. Agent commits carry the run_id of the instruction
that produced them, which enables "undo the last instruction".
"""

from datetime import UTC, datetime
from typing import Literal

from pydantic import Field

from auteur.timeline.models import Media, Model, Timeline
from auteur.timeline.ops import Op, apply, new_id

Author = Literal["agent", "user"]


class Commit(Model):
    id: str
    author: Author
    label: str
    ops: list[Op]
    run_id: str | None = None
    at: datetime
    before: Timeline


class ChatMessage(Model):
    role: Literal["user", "assistant"]
    text: str
    run_id: str
    at: datetime
    images: list[str] = Field(default_factory=list, description="Reference image ids attached to the message")


class ReferenceImage(Model):
    """A still the user wants the grade to look like; the file is <project_dir>/refs/<id>.jpg."""

    id: str
    name: str


class TrackInfo(Model):
    """Index entry for an object track; the boxes live in <project_dir>/tracks/<id>.json."""

    id: str
    media_id: str
    prompt: str
    object_ids: list[str]


class Project(Model):
    id: str
    name: str
    media: dict[str, Media] = Field(default_factory=dict)
    timeline: Timeline = Field(default_factory=Timeline)
    history: list[Commit] = Field(default_factory=list)
    redo_stack: list[Commit] = Field(default_factory=list)
    chat: list[ChatMessage] = Field(default_factory=list)
    last_render: str | None = Field(None, description="Path of the latest render, relative to the project dir")
    tracks: dict[str, TrackInfo] = Field(default_factory=dict)
    references: dict[str, ReferenceImage] = Field(default_factory=dict)
    spent: float = Field(0, description="Meta Model API spend in USD across all runs")

    def commit(self, author: Author, label: str, ops: list[Op], run_id: str | None = None) -> Commit:
        """Apply ops atomically: if any op fails, the timeline is left unchanged."""
        before = self.timeline
        tl = before
        for op in ops:
            tl = apply(tl, op, self.media)
        c = Commit(
            id=new_id("commit"), author=author, label=label, ops=ops, run_id=run_id,
            at=datetime.now(UTC), before=before,
        )
        self.timeline = tl
        self.history.append(c)
        self.redo_stack.clear()
        return c

    def undo(self) -> Commit | None:
        if not self.history:
            return None
        c = self.history.pop()
        self.redo_stack.append(c.model_copy(update={"before": self.timeline}))
        self.timeline = c.before
        return c

    def redo(self) -> Commit | None:
        if not self.redo_stack:
            return None
        c = self.redo_stack.pop()
        after = c.before
        self.history.append(c.model_copy(update={"before": self.timeline}))
        self.timeline = after
        return c

    def undo_run(self, run_id: str) -> int:
        """Undo every commit of an agent run, provided they are the most recent ones."""
        n = 0
        while self.history and self.history[-1].run_id == run_id:
            self.undo()
            n += 1
        return n

    def history_summary(self, limit: int = 20) -> list[str]:
        """Compact log for the agent prompt, so it knows what the user changed by hand."""
        return [f"[{c.author}] {c.label}" for c in self.history[-limit:]]
