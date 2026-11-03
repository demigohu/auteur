"use client";

import {
  ArrowUp,
  CaretRight,
  CheckCircle,
  Circle,
  CircleNotch,
  ShieldCheck,
  ShieldWarning,
  ImageSquare,
  Stop,
  X,
  XCircle,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { briefKey } from "@/components/studio/CreateProjectDialog";
import { fileUrl } from "@/lib/api";
import { type LogItem, type RunState, type StepStatus, useEditor } from "@/lib/store";

const SUGGESTIONS = [
  "Make a 9:16 video around 30 seconds, open with the best moment, add subtitles.",
  "Remove the ums, uhs and long pauses.",
  "Give it a warm cinematic grade, nothing over the top.",
];

// Human labels for the agent's tools, shown in the log instead of function names.
const TOOL_LABEL: Record<string, string> = {
  plan: "Planning",
  listen: "Listening to footage",
  watch: "Watching footage",
  track: "Tracking with SAM 3.1",
  reframe: "Reframing to the subject",
  grade: "Color grading",
  music: "Adding music",
  cut_on_beat: "Cutting on the beat",
  transitions: "Setting transitions",
  speed: "Changing speed",
  zoom: "Adding a slow zoom",
  cinematic_finish: "Cinematic finish",
  broll: "Laying B-roll",
  effect: "Applying effects",
  assemble: "Building the timeline",
  edit_timeline: "Editing the timeline",
  remove_fillers: "Removing fillers and pauses",
  subtitles: "Writing subtitles",
  render: "Rendering",
};

export function AgentTab() {
  const project = useEditor((s) => s.project);
  const run = useEditor((s) => s.run);
  const startRun = useEditor((s) => s.startRun);
  const stopRun = useEditor((s) => s.stopRun);
  const uploadReference = useEditor((s) => s.uploadReference);
  const [attached, setAttached] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // A brief written in New project waits in sessionStorage until the editor opens.
  const [draft, setDraft] = useState(() => {
    try {
      return sessionStorage.getItem(briefKey(useEditor.getState().project?.id ?? "")) ?? "";
    } catch {
      return "";
    }
  });
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
    try {
      sessionStorage.removeItem(briefKey(project?.id ?? ""));
    } catch {}
    const refs = attached;
    setAttached([]);
    await startRun(t, refs);
  };

  // Stills to grade toward: pasted screenshots, dropped files or picked ones. Each is uploaded right
  // away and rides along with the next instruction.
  const attach = async (files: Iterable<File>) => {
    for (const f of files) {
      if (!f.type.startsWith("image/") || attached.length >= 4) continue;
      const id = await uploadReference(f.name ? f : new File([f], "screenshot.png", { type: f.type }));
      if (id) setAttached((a) => (a.includes(id) ? a : [...a, id].slice(0, 4)));
    }
  };
  const refsById = new Map((project?.references ?? []).map((r) => [r.id, r]));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {history.map((m, i) => (
          <ChatLine key={`${m.run_id}-${m.role}-${i}`} role={m.role} text={m.text} images={(m.images ?? []).map((id) => refsById.get(id)?.url).filter(Boolean) as string[]} />
        ))}
        {run && (
          <>
            <ChatLine role="user" text={run.instruction} images={run.images.map((id) => refsById.get(id)?.url).filter(Boolean) as string[]} />
            <RunView run={run} />
            {runReply && run.status !== "running" && <ChatLine role="assistant" text={runReply.text} />}
          </>
        )}
        {!history.length && !run && <Suggestions onPick={send} disabled={!project?.media.length} />}
      </div>

      <form
        className="shrink-0 border-t-2 border-edge p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <div
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            setDragging(false);
            attach(e.dataTransfer.files);
          }}
          className={`rounded-[14px] border-2 bg-card shadow-[0_3px_0_0_var(--edge-shadow)] transition-shadow focus-within:shadow-[0_4px_0_0_var(--tomato)] ${
            dragging ? "border-dashed border-accent" : "border-edge"
          }`}
        >
          {attached.length > 0 && (
            <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Attached reference images">
              {attached.map((id) => {
                const r = refsById.get(id);
                return r ? (
                  <li key={id} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- served by the API host */}
                    <img src={fileUrl(r.url)} alt={r.name} className="h-14 w-20 rounded-[8px] border-2 border-edge object-cover" />
                    <button
                      type="button"
                      aria-label={`Remove ${r.name}`}
                      onClick={() => setAttached((a) => a.filter((x) => x !== id))}
                      className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border-2 border-edge bg-card text-card-text"
                    >
                      <X size={10} weight="bold" />
                    </button>
                  </li>
                ) : null;
              })}
            </ul>
          )}
          <label htmlFor="instruction" className="sr-only">
            Instruction for the agent
          </label>
          <textarea
            id="instruction"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const images = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
              if (!images.length) return;
              e.preventDefault();
              attach(images);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            rows={3}
            placeholder={
              running ? "The agent is working..." : attached.length ? "e.g. grade it like this still" : "Direct it like a human editor"
            }
            disabled={running}
            className="block w-full resize-none bg-transparent px-3 pt-2.5 text-sm text-text placeholder:text-faint focus:outline-none disabled:opacity-60"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => picker.current?.click()}
                disabled={running || attached.length >= 4}
                aria-label="Attach a reference image"
                title="Attach a reference image (or paste a screenshot)"
                className="grid size-8 place-items-center rounded-full text-muted transition hover:bg-raised hover:text-text disabled:opacity-40"
              >
                <ImageSquare size={16} />
              </button>
              <input
                ref={picker}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                onChange={(e) => {
                  attach(e.target.files ?? []);
                  e.target.value = "";
                }}
              />
              <span className="label text-[10px] text-faint">Enter to send · paste an image</span>
            </span>
            {running ? (
              <button
                type="button"
                onClick={stopRun}
                className="flex items-center gap-1.5 rounded-full border-2 border-edge px-3 py-1 text-xs font-semibold text-text transition hover:bg-raised active:scale-[0.97]"
              >
                <Stop size={12} weight="fill" /> Stop
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Send instruction"
                disabled={!draft.trim()}
                className="grid size-9 place-items-center rounded-full border-2 border-ink bg-pink text-ink transition hover:bg-lime active:scale-[0.94] disabled:opacity-30"
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

function ChatLine({ role, text, images = [] }: { role: "user" | "assistant"; text: string; images?: string[] }) {
  if (role === "user") {
    return (
      <div className="ml-6 rounded-[14px] rounded-br-[4px] border-2 border-edge bg-card px-3 py-2 text-sm leading-relaxed text-card-text">
        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {images.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element -- served by the API host
              <img key={url} src={fileUrl(url)} alt="Reference" className="h-16 rounded-[6px] border border-line object-cover" />
            ))}
          </div>
        )}
        {text}
      </div>
    );
  }
  return <div className="whitespace-pre-wrap text-sm leading-relaxed text-text/90">{text}</div>;
}

function Suggestions({ onPick, disabled }: { onPick: (t: string) => void; disabled: boolean }) {
  return (
    <div className="pt-2">
      <p className="display text-[34px] text-text">What are we editing?</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        {disabled ? "Upload footage to the media bin first." : "The agent watches and listens to your footage. Try one:"}
      </p>
      <div className="mt-3 space-y-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s)}
            className="block w-full rounded-[14px] border-2 border-line px-3 py-2 text-left text-[13px] leading-snug text-muted transition hover:border-line-strong hover:bg-card hover:text-text active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40"
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
        <div className="rounded-[14px] border-2 border-edge bg-card p-3 shadow-[0_3px_0_0_var(--edge-shadow)]">
          <p className="label mb-2.5 text-muted">⁞ Edit plan</p>
          <ol className="space-y-1.5">
            {run.plan.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
                <span className="w-5 shrink-0 pt-px font-mono text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</span>
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
        <p className="text-xs text-danger">Run ended ({run.status}).</p>
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
        className={`rounded-[10px] border-2 px-3 py-2 text-[13px] ${
          item.passed ? "border-ink bg-lime text-forest" : "border-tomato bg-tomato/10"
        }`}
      >
        <div className="flex items-center gap-2">
          {item.passed ? (
            <ShieldCheck size={15} weight="fill" className="text-forest" />
          ) : (
            <ShieldWarning size={15} weight="fill" className="text-danger" />
          )}
          <span className="text-text">{item.passed ? "Checker: passed" : "Checker found problems"}</span>
          <a
            href={fileUrl(`/files/${useEditor.getState().project?.id}/${item.render}`)}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs text-muted underline-offset-2 hover:text-text hover:underline"
          >
            View render
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
            className="mx-1.5 mt-1 max-h-56 overflow-auto rounded-[10px] bg-ink p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-paper/75"
          >
            {`${JSON.stringify(item.args, null, 2)}\n\n${item.output ?? "..."}`}
          </motion.pre>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function argSummary(args: Record<string, unknown>): string {
  if (Array.isArray(args.clips)) return `${args.clips.length} clips`;
  if (Array.isArray(args.ops)) return (args.ops as { op: string }[]).map((o) => o.op).join(", ");
  if (typeof args.label === "string") return args.label;
  if (typeof args.prompt === "string") return `"${args.prompt}"`;
  if (typeof args.kind === "string") return args.kind;
  if (typeof args.look === "string") return args.look;
  if (typeof args.style === "string") return args.style;
  if (typeof args.speed === "number") return `${args.speed}x`;
  if (typeof args.every === "number") return `every ${args.every} beats`;
  if (typeof args.smoothing === "number") return `smooth ${args.smoothing}s`;
  if (typeof args.focus === "string") return args.focus;
  if (args.final === true) return "final";
  return "";
}
