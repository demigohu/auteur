"use client";

import {
  ArrowUp,
  CaretRight,
  CheckCircle,
  Circle,
  CircleNotch,
  ShieldCheck,
  ShieldWarning,
  Stop,
  XCircle,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { fileUrl } from "@/lib/api";
import { type LogItem, type RunState, type StepStatus, useEditor } from "@/lib/store";

const SUGGESTIONS = [
  "Jadikan video 9:16 sekitar 30 detik, buka dengan momen paling seru, kasih subtitle.",
  "Buang 'eh', 'hmm', dan jeda yang kelamaan.",
  "Warnanya bikin hangat cinematic, jangan berlebihan.",
];

// Human labels for the agent's tools, shown in the log instead of function names.
const TOOL_LABEL: Record<string, string> = {
  rencana: "Menyusun rencana",
  dengar: "Mendengarkan footage",
  tonton: "Menonton footage",
  lacak: "Melacak objek dengan SAM 3.1",
  reframe: "Reframe mengikuti subjek",
  efek: "Menerapkan efek",
  susun: "Menyusun timeline",
  ubah_timeline: "Mengubah timeline",
  buang_filler: "Membuang filler dan jeda",
  subtitle: "Membuat subtitle",
  render: "Merender",
};

export function AgentTab() {
  const project = useEditor((s) => s.project);
  const run = useEditor((s) => s.run);
  const startRun = useEditor((s) => s.startRun);
  const stopRun = useEditor((s) => s.stopRun);
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const running = run?.status === "running" || (project?.busy ?? false);

  const chat = project?.chat ?? [];
  // The live run is drawn from events; skip its messages in the stored chat to avoid duplicates.
  const history = run ? chat.filter((m) => m.run_id !== run.id) : chat;
  const runReply = run && chat.find((m) => m.run_id === run.id && m.role === "assistant");

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [chat.length, run?.log.length, run?.plan]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || running) return;
    setDraft("");
    await startRun(t);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {history.map((m, i) => (
          <ChatLine key={`${m.run_id}-${m.role}-${i}`} role={m.role} text={m.text} />
        ))}
        {run && (
          <>
            <ChatLine role="user" text={run.instruction} />
            <RunView run={run} />
            {runReply && run.status !== "running" && <ChatLine role="assistant" text={runReply.text} />}
          </>
        )}
        {!history.length && !run && <Suggestions onPick={send} disabled={!project?.media.length} />}
      </div>

      <form
        className="shrink-0 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <div className="rounded-md border border-line-strong bg-panel-2 focus-within:border-accent/60">
          <label htmlFor="instruction" className="sr-only">
            Arahan untuk agen
          </label>
          <textarea
            id="instruction"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            rows={3}
            placeholder={running ? "Agen sedang bekerja..." : "Arahkan seperti ke editor manusia"}
            disabled={running}
            className="block w-full resize-none bg-transparent px-3 pt-2.5 text-sm text-text placeholder:text-faint focus:outline-none disabled:opacity-60"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="pl-1 text-[11px] text-faint">Enter untuk kirim</span>
            {running ? (
              <button
                type="button"
                onClick={stopRun}
                className="flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1 text-xs text-text transition hover:bg-raised active:scale-[0.97]"
              >
                <Stop size={12} weight="fill" /> Hentikan
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Kirim arahan"
                disabled={!draft.trim()}
                className="grid size-7 place-items-center rounded-md bg-accent text-accent-ink transition hover:brightness-110 active:scale-[0.95] disabled:opacity-30"
              >
                <ArrowUp size={14} weight="bold" />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

function ChatLine({ role, text }: { role: "user" | "assistant"; text: string }) {
  if (role === "user") {
    return (
      <div className="ml-6 rounded-md bg-raised px-3 py-2 text-sm leading-relaxed text-text">{text}</div>
    );
  }
  return <div className="whitespace-pre-wrap text-sm leading-relaxed text-text/90">{text}</div>;
}

function Suggestions({ onPick, disabled }: { onPick: (t: string) => void; disabled: boolean }) {
  return (
    <div className="pt-2">
      <p className="text-sm text-text">Apa yang mau diedit?</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        {disabled ? "Unggah footage dulu di media bin." : "Agen melihat dan mendengar footage-mu. Coba salah satu:"}
      </p>
      <div className="mt-3 space-y-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s)}
            className="block w-full rounded-md border border-line px-3 py-2 text-left text-[13px] leading-snug text-muted transition hover:border-line-strong hover:text-text active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function RunView({ run }: { run: RunState }) {
  return (
    <div className="space-y-3">
      {run.plan.length > 0 && (
        <div className="rounded-md border border-line bg-panel-2 p-3">
          <p className="mb-2 text-xs font-medium text-muted">Rencana edit</p>
          <ol className="space-y-1.5">
            {run.plan.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
                <StepIcon status={p.status} />
                <span className={p.status === "done" ? "text-muted" : "text-text"}>{p.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="space-y-1">
        <AnimatePresence initial={false}>
          {run.log.map((item, i) => (
            <LogRow key={i} item={item} progress={i === run.log.length - 1 ? run.progress : null} />
          ))}
        </AnimatePresence>
      </div>
      {run.status !== "running" && run.status !== "done" && (
        <p className="text-xs text-danger">Run berhenti ({run.status}).</p>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  const cls = "mt-0.5 shrink-0";
  if (status === "done") return <CheckCircle size={15} weight="fill" className={`${cls} text-ok`} />;
  if (status === "failed") return <XCircle size={15} weight="fill" className={`${cls} text-danger`} />;
  if (status === "running") return <CircleNotch size={15} weight="bold" className={`${cls} animate-spin text-accent`} />;
  return <Circle size={15} className={`${cls} text-faint`} />;
}

function LogRow({ item, progress }: { item: LogItem; progress: number | null }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const enter = reduce ? false : { opacity: 0, y: 4 };

  if (item.kind === "thought") {
    return (
      <motion.p initial={enter} animate={{ opacity: 1, y: 0 }} className="py-1 text-[13px] italic leading-snug text-muted">
        {item.text}
      </motion.p>
    );
  }

  if (item.kind === "check") {
    return (
      <motion.div
        initial={enter}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-md border px-3 py-2 text-[13px] ${
          item.passed ? "border-ok/30 bg-ok/5" : "border-danger/40 bg-danger/5"
        }`}
      >
        <div className="flex items-center gap-2">
          {item.passed ? (
            <ShieldCheck size={15} weight="fill" className="text-ok" />
          ) : (
            <ShieldWarning size={15} weight="fill" className="text-danger" />
          )}
          <span className="text-text">{item.passed ? "Pemeriksa: lolos" : "Pemeriksa menemukan masalah"}</span>
          <a
            href={fileUrl(`/files/${useEditor.getState().project?.id}/${item.render}`)}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Lihat render
          </a>
        </div>
        {item.issues.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 pl-6 text-xs leading-relaxed text-muted">
            {item.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </motion.div>
    );
  }

  const pendingResult = item.ok === undefined;
  return (
    <motion.div initial={enter} animate={{ opacity: 1, y: 0 }} className="text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-raised"
      >
        {pendingResult ? (
          <CircleNotch size={13} weight="bold" className="shrink-0 animate-spin text-accent" />
        ) : item.ok ? (
          <CheckCircle size={13} weight="fill" className="shrink-0 text-faint" />
        ) : (
          <XCircle size={13} weight="fill" className="shrink-0 text-danger" />
        )}
        <span className="text-text/90">{TOOL_LABEL[item.tool] ?? item.tool}</span>
        <span className="truncate font-mono text-[11px] text-faint">{argSummary(item.args)}</span>
        <CaretRight size={11} className={`ml-auto shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {pendingResult && progress !== null && (
        <div className="mx-1.5 mt-1 h-0.5 overflow-hidden rounded-full">
          <motion.div className="h-full bg-accent" animate={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.pre
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mx-1.5 mt-1 max-h-56 overflow-auto rounded-md bg-bg p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted"
          >
            {`${JSON.stringify(item.args, null, 2)}\n\n${item.output ?? "..."}`}
          </motion.pre>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function argSummary(args: Record<string, unknown>): string {
  if (Array.isArray(args.clips)) return `${args.clips.length} klip`;
  if (Array.isArray(args.ops)) return (args.ops as { op: string }[]).map((o) => o.op).join(", ");
  if (typeof args.label === "string") return args.label;
  if (typeof args.prompt === "string") return `"${args.prompt}"`;
  if (typeof args.jenis === "string") return args.jenis;
  if (typeof args.halus === "number") return `halus ${args.halus}s`;
  if (typeof args.fokus === "string") return args.fokus;
  if (args.final === true) return "final";
  return "";
}
