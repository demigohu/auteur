"""In-process pub/sub that feeds the editor's Server-Sent Events stream.

Events of the current run are buffered, so a browser that connects (or reconnects) mid-run first
replays what it missed.
"""

import asyncio
from collections import defaultdict
from typing import Any

Event = dict[str, Any]


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[Event]]] = defaultdict(set)
        self._replay: dict[str, list[Event]] = defaultdict(list)

    def publish(self, project_id: str, event: Event, replay: bool = True) -> None:
        """`replay=False` for events outside agent runs (export progress): the project view carries
        their latest state, so a late subscriber doesn't need the history."""
        if event.get("type") == "run_started":
            self._replay[project_id] = []
        if replay:
            self._replay[project_id].append(event)
        for q in self._subscribers[project_id]:
            q.put_nowait(event)
        if event.get("type") == "run_finished":
            # A finished run lives on in the project itself; only an active run needs replaying.
            self._replay[project_id] = []

    def subscribe(self, project_id: str) -> asyncio.Queue[Event]:
        q: asyncio.Queue[Event] = asyncio.Queue()
        for e in self._replay[project_id]:
            q.put_nowait(e)
        self._subscribers[project_id].add(q)
        return q

    def unsubscribe(self, project_id: str, q: asyncio.Queue[Event]) -> None:
        self._subscribers[project_id].discard(q)


bus = EventBus()
