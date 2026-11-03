"""The agent loop: Muse Spark plans, then calls one tool per turn until it answers in plain text.

The run holds the project lock for its whole duration, so manual edits wait (the UI shows the
timeline as locked). Every step is published on the event bus for the editor's live log.
"""

import asyncio
from datetime import UTC, datetime
from typing import Any

from openai import AsyncOpenAI

from auteur import costs
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
- First call `plan` with a short plan in the user's language (and the target duration/aspect if \
they gave one). For a small revision, a one-step plan is fine.
- Then do the plan, one tool call per turn, passing `step` with the plan step's index.
- Look and listen before cutting: `watch` describes what is on screen, `listen` what is said. Use \
both to choose moments; skip shots the camera ruined (dark, pointing at the floor).
- To build a story from raw footage, pick the best source ranges and call `assemble`. Open with the \
strongest moment when asked. Respect the requested length.
- For a vertical or square version: set the aspect with `edit_timeline`, `track` the subject \
("person"), then `reframe` so the crop follows it. To hide faces or plates: `track` ("face", \
"license plate"), then `effect` blur with the main subject in `except_ids` unless asked otherwise. `track` is slow \
(1-3 min), so track each media and prompt once and reuse the track.
- Cut filler with `remove_fillers` after `assemble`; generate subtitles with `subtitles` after all cuts and \
after setting the aspect. Pick its `style` from the request: karaoke for creator/Reels/TikTok videos, \
bold or pop for punchy short content, clean for calm or informative videos; match its `color` to the \
grade or the user's brand color if they gave one.
- Montages ("a day in my life", travel, cinematic): `watch` every clip, order them as a story \
(chronologically by recording time for a day-in-the-life), keep each shot short (1.5-4s) and \
`assemble` them. Then, in this order: `speed` 0.5 on one or two beautiful moments (60fps footage \
only), any trims to hit the length, `transitions` (crossfade or dip_black for calm/cinematic, mostly hard \
cuts for energetic), then `music` and `cut_on_beat` LAST among timing edits (`every` 2 for most, 4 \
for calm, 1 for hype), since any later trim knocks cuts off the beat. Then `zoom` on static shots, \
and for a cinematic look `grade` (cinematic or film) plus `cinematic_finish` (letterbox only for 16:9). \
Use `broll` to cover a talking shot with what they talk about.
- Use `edit_timeline` for precise revisions (trim, move, split, delete, text, grade, crop, aspect). \
Keep the user's manual edits unless they ask otherwise; the history shows who changed what.
- For any color request ("warm", "cinematic", "make it look like film", "fix the colors", "match \
the clips"), use `grade`: pick the closest look, keep `intensity` around 0.5-0.8 unless asked for a \
strong look, and keep `auto_correct` on. Read the measured results it returns.
- Finish with `render`. The checker also verifies the subject stays in frame and blurs do not \
leak. If it FAILS, fix exactly what it reports (e.g. `reframe` those clips with a smaller `smoothing`) \
and render again.
- When done, reply briefly in the user's language: what you did and anything they should know. No markdown tables.
"""


def state_message(store: Store, project_id: str) -> str:
    p = store.get(project_id)
    def describe_media(m) -> str:
        if m.kind == "audio":
            return f"  {m.id}: {m.name}, MUSIC/AUDIO, {m.duration:.1f}s"
        shot = f", recorded {m.recorded_at}" if m.recorded_at else ""
        return (f"  {m.id}: {m.name}, video {m.duration:.1f}s, {m.width}x{m.height} @ {m.fps:.0f}fps, "
                f"{'with sound' if m.has_audio else 'silent'}{shot}")

    media = "\n".join(describe_media(m) for m in p.media.values()) or "  (none uploaded)"
    history = "\n".join(f"  {h}" for h in p.history_summary(15)) or "  (no edits yet)"
    tracks = "\n".join(f"  {t.id}: '{t.prompt}' on {t.media_id}" for t in p.tracks.values()) or "  (none)"
    return (
        f"Current project state.\nMedia:\n{media}\nTimeline:\n{describe_timeline(p)}\n"
        f"Existing tracks (reuse them):\n{tracks}\nRecent edit history (oldest first):\n{history}"
    )


async def run_agent(store: Store, project_id: str, run_id: str, instruction: str, lock: asyncio.Lock) -> None:
    def emit(event: dict[str, Any]) -> None:
        bus.publish(project_id, {**event, "run_id": run_id})

    status = "error"
    try:
        status = await _run(store, project_id, run_id, instruction, lock, emit)
    except asyncio.CancelledError:
        status = "cancelled"
        raise
    finally:
        # Announced only after the lock is released: the editor unlocks on this event, and an edit sent
        # while the lock was still held would bounce with "the agent is editing this project".
        emit({"type": "run_finished", "status": status})


async def _run(store: Store, project_id: str, run_id: str, instruction: str, lock: asyncio.Lock, emit) -> str:
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
                ctx.add_cost(costs.spark(r.usage))
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
                status, reply = "stopped", "I stopped at the step limit. Have a look at the timeline."
        except StopRun as e:
            status, reply = "failed", (
                "I stopped because the checker still found problems after 3 tries. "
                "The problem spots are marked red on the timeline."
            )
        except asyncio.CancelledError:
            status, reply = "cancelled", "Stopped."
            raise
        except Exception as e:
            status, reply = "error", f"Something went wrong: {e}"
        finally:
            p.chat.append(ChatMessage(role="assistant", text=reply or "Done.", run_id=run_id, at=datetime.now(UTC)))
            store.save(p)
            emit({"type": "message", "text": reply or "Done."})
        return status
