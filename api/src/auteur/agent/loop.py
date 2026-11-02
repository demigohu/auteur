"""The agent loop: Muse Spark plans, then calls one tool per turn until it answers in plain text.

The run holds the project lock for its whole duration, so manual edits wait (the UI shows the
timeline as locked). Every step is published on the event bus for the editor's live log.
"""

import asyncio
from datetime import UTC, datetime
from typing import Any

from openai import AsyncOpenAI

from auteur.agent.tools import TOOLS_BY_NAME, StopRun, ToolContext, ToolError, describe_timeline, parse_args, tool_specs
from auteur.config import settings
from auteur.events import bus
from auteur.store import Store
from auteur.timeline.history import ChatMessage

MODEL = "muse-spark-1.3"
MAX_TURNS = 30
HISTORY_MESSAGES = 10

SYSTEM = """You are Auteur, a video editor working inside a DaVinci-like editor. The user directs you \
in plain language, like they would a human editor; you edit the timeline with tools.

How to work:
- First call `rencana` with a short plan in the user's language (and the target duration/aspect if \
they gave one). For a small revision, a one-step plan is fine.
- Then do the plan, one tool call per turn, passing `step` with the plan step's index.
- Look and listen before cutting: `tonton` describes what is on screen, `dengar` what is said. Use \
both to choose moments; skip shots the camera ruined (dark, pointing at the floor).
- To build a story from raw footage, pick the best source ranges and call `susun`. Open with the \
strongest moment when asked. Respect the requested length.
- For a vertical or square version: set the aspect with `ubah_timeline`, `lacak` the subject \
("person"), then `reframe` so the crop follows it. To hide faces or plates: `lacak` ("face", \
"license plate"), then `efek` blur with the main subject in `kecuali` unless asked otherwise. `lacak` is slow \
(1-3 min), so track each media and prompt once and reuse the track.
- Cut filler with `buang_filler` after `susun`; generate subtitles with `subtitle` after all cuts.
- Use `ubah_timeline` for precise revisions (trim, move, split, delete, text, grade, crop, aspect). \
Keep the user's manual edits unless they ask otherwise; the history shows who changed what.
- Finish with `render`. The checker also verifies the subject stays in frame and blurs do not \
leak. If it FAILS, fix exactly what it reports (e.g. `reframe` those clips with a smaller `halus`) \
and render again.
- When done, reply briefly in the user's language: what you did and anything they should know. No markdown tables.
"""


def state_message(store: Store, project_id: str) -> str:
    p = store.get(project_id)
    media = "\n".join(
        f"  {m.id}: {m.name}, {m.duration:.1f}s, {m.width}x{m.height}, {'audio' if m.has_audio else 'no audio'}"
        for m in p.media.values()
    ) or "  (none uploaded)"
    history = "\n".join(f"  {h}" for h in p.history_summary(15)) or "  (no edits yet)"
    tracks = "\n".join(f"  {t.id}: '{t.prompt}' on {t.media_id}" for t in p.tracks.values()) or "  (none)"
    return (
        f"Current project state.\nMedia:\n{media}\nTimeline:\n{describe_timeline(p)}\n"
        f"Existing tracks (reuse them):\n{tracks}\nRecent edit history (oldest first):\n{history}"
    )


async def run_agent(store: Store, project_id: str, run_id: str, instruction: str, lock: asyncio.Lock) -> None:
    def emit(event: dict[str, Any]) -> None:
        bus.publish(project_id, {**event, "run_id": run_id})

    async with lock:
        p = store.get(project_id)
        p.chat.append(ChatMessage(role="user", text=instruction, run_id=run_id, at=datetime.now(UTC)))
        store.save(p)
        emit({"type": "run_started", "instruction": instruction})

        ctx = ToolContext(
            project=p, project_dir=store.project_dir(project_id), run_id=run_id, emit=emit,
            save=lambda: store.save(p),
        )
        items: list[dict[str, Any]] = [
            {"role": m.role, "content": m.text} for m in p.chat[-HISTORY_MESSAGES - 1 : -1]
        ]
        items.append({"role": "user", "content": f"{state_message(store, project_id)}\n\nInstruction: {instruction}"})

        client = AsyncOpenAI(api_key=settings.meta_api_key, base_url=settings.meta_base_url)
        status, reply = "done", ""
        try:
            for _ in range(MAX_TURNS):
                r = await client.responses.create(
                    model=MODEL, instructions=SYSTEM, input=items, tools=tool_specs(), parallel_tool_calls=False,
                )
                items += [o.model_dump(exclude_none=True) for o in r.output]
                calls = [o for o in r.output if o.type == "function_call"]
                narration = "".join(
                    c.text for o in r.output if o.type == "message" for c in o.content if c.type == "output_text"
                ).strip()
                if not calls:
                    reply = narration
                    break
                if narration:
                    emit({"type": "thought", "text": narration})

                for call in calls:
                    tool = TOOLS_BY_NAME.get(call.name)
                    step = None
                    try:
                        if tool is None:
                            raise ToolError(f"Unknown tool {call.name!r}")
                        args = parse_args(tool, call.arguments)
                        step = args.step
                        emit({"type": "tool_call", "tool": call.name, "args": args.model_dump(exclude={"step"}), "step": step})
                        output = await tool.run(ctx, args)
                        emit({"type": "tool_result", "tool": call.name, "ok": True, "output": output[:2000], "step": step})
                    except ToolError as e:
                        output = f"ERROR: {e}"
                        emit({"type": "tool_result", "tool": call.name, "ok": False, "output": str(e), "step": step})
                    items.append({"type": "function_call_output", "call_id": call.call_id, "output": output})
            else:
                status, reply = "stopped", "Aku berhenti karena sudah mencapai batas langkah. Cek timeline-nya ya."
        except StopRun as e:
            status, reply = "failed", (
                "Aku berhenti karena pemeriksa masih menemukan masalah setelah 3 kali percobaan. "
                "Bagian yang bermasalah ditandai merah di timeline."
            )
        except asyncio.CancelledError:
            status, reply = "cancelled", "Dihentikan."
            raise
        except Exception as e:
            status, reply = "error", f"Terjadi kesalahan: {e}"
        finally:
            p.chat.append(ChatMessage(role="assistant", text=reply or "Selesai.", run_id=run_id, at=datetime.now(UTC)))
            store.save(p)
            emit({"type": "message", "text": reply or "Selesai."})
            emit({"type": "run_finished", "status": status})
