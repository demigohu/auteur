"use client";

import { ArrowArcLeft, ArrowArcRight, ArrowCounterClockwise, Robot, User } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import type { CommitView } from "@/lib/api";
import { useEditor } from "@/lib/store";

type Group = { runId: string | null; author: "agent" | "user"; commits: CommitView[] };

/** Consecutive commits of one agent instruction collapse into one group; user edits stand alone. */
function groupCommits(history: CommitView[]): Group[] {
  const groups: Group[] = [];
  for (const c of history) {
    const last = groups.at(-1);
    if (c.run_id && last?.runId === c.run_id) last.commits.push(c);
    else groups.push({ runId: c.run_id, author: c.author, commits: [c] });
  }
  return groups.reverse();
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

export function HistoryTab() {
  const project = useEditor((s) => s.project);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const undoRun = useEditor((s) => s.undoRun);
  const reduce = useReducedMotion();
  if (!project) return null;

  const groups = groupCommits(project.history);
  const instruction = (runId: string) => project.chat.find((m) => m.run_id === runId && m.role === "user")?.text;
  const locked = project.busy;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-2 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={undo}
          disabled={locked || !project.can_undo}
          className="flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs text-text transition hover:bg-raised active:scale-[0.98] disabled:opacity-35"
        >
          <ArrowArcLeft size={13} /> Undo
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={locked || !project.can_redo}
          className="flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs text-text transition hover:bg-raised active:scale-[0.98] disabled:opacity-35"
        >
          <ArrowArcRight size={13} /> Redo
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {groups.length === 0 ? (
          <p className="pt-1 text-sm leading-relaxed text-muted">
            Belum ada perubahan. Setiap edit dari agen maupun dari kamu akan tercatat di sini dan bisa dibatalkan.
          </p>
        ) : (
          <ol className="space-y-2">
            {groups.map((g, i) => (
              <motion.li
                key={g.commits[0].id}
                layout={reduce ? false : "position"}
                className="rounded-md border border-line bg-panel-2 p-3"
              >
                <div className="flex items-start gap-2">
                  {g.author === "agent" ? (
                    <Robot size={15} className="mt-0.5 shrink-0 text-accent" />
                  ) : (
                    <User size={15} className="mt-0.5 shrink-0 text-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-snug text-text">
                      {g.runId ? (instruction(g.runId) ?? "Arahan agen") : g.commits[0].label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-faint">
                      {g.author === "agent" ? "Agen" : "Kamu"}, {clock(g.commits[0].at)}
                    </p>
                  </div>
                  {i === 0 && g.runId && (
                    <button
                      type="button"
                      onClick={() => undoRun(g.runId!)}
                      disabled={locked}
                      title="Batalkan semua edit dari arahan ini"
                      className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted transition hover:bg-raised hover:text-text disabled:opacity-35"
                    >
                      <ArrowCounterClockwise size={12} /> Batalkan
                    </button>
                  )}
                </div>
                {g.runId && (
                  <ul className="mt-2 space-y-0.5 border-l border-line-strong pl-3">
                    {g.commits.map((c) => (
                      <li key={c.id} className="text-xs leading-relaxed text-muted">
                        {c.label}
                      </li>
                    ))}
                  </ul>
                )}
              </motion.li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
