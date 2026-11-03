"use client";

import {
  ArrowDown,
  ArrowUp,
  CircleNotch,
  Code,
  FilmSlate,
  Hammer,
  NotePencil,
  Plus,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { fileUrl, type StoryboardEdit } from "@/lib/api";
import { useEditor } from "@/lib/store";
import { clipStarts } from "@/lib/time";
import type { Storyboard, StoryScene } from "@/lib/timeline";

const MAX_SECONDS = 180;
/** Rough Muse Wonder cost per scene build (write, look at its own frames, sometimes a fix). */
const COST_PER_SCENE = 0.25;

type DraftScene = StoryboardEdit["scenes"][number];

const editable = (b: Storyboard): StoryboardEdit => ({
  style: b.style,
  scenes: b.scenes.map((s) => ({ id: s.id, title: s.title, duration: s.duration, brief: s.brief, images: s.images })),
});

/** Videos made in code: the storyboard Muse Wonder wrote, editable scene by scene, with build buttons. */
export function StoryboardTab() {
  const board = useEditor((s) => s.project?.storyboard ?? null);
  if (!board) return <EmptyStoryboard />;
  // Remount (and drop local edits) only when the storyboard's content changes on the server, not when
  // a scene's build status does.
  return <StoryboardEditor key={JSON.stringify(editable(board))} board={board} />;
}

function StoryboardEditor({ board }: { board: Storyboard }) {
  const project = useEditor((s) => s.project);
  const running = useEditor((s) => s.run?.status === "running" || (s.project?.busy ?? false));
  const pending = useEditor((s) => s.pending);
  const editStoryboard = useEditor((s) => s.editStoryboard);
  const buildScenes = useEditor((s) => s.buildScenes);
  const [draft, setDraft] = useState<StoryboardEdit>(() => editable(board));
  const dirty = JSON.stringify(draft) !== JSON.stringify(editable(board));
  const locked = running || Boolean(pending);

  const byId = new Map(board.scenes.map((s) => [s.id, s]));
  const total = draft.scenes.reduce((t, s) => t + (Number(s.duration) || 0), 0);
  const toBuild = board.scenes.filter((s) => s.status !== "ready" || !s.media_id);
  // "building" outlives a run only if the server stopped mid-build; such a scene simply needs a build.
  const statusOf = (s: StoryScene | undefined) => (s?.status === "building" && !running ? "draft" : (s?.status ?? "draft"));
  const tooLong = total > MAX_SECONDS;

  const update = (i: number, patch: Partial<DraftScene>) =>
    setDraft((d) => ({ ...d, scenes: d.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, by: number) =>
    setDraft((d) => {
      const scenes = [...d.scenes];
      const [s] = scenes.splice(i, 1);
      scenes.splice(i + by, 0, s);
      return { ...d, scenes };
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="label text-faint">⁞ Made in code</p>
            <p className="display mt-1 text-[30px] leading-none text-text">Storyboard</p>
          </div>
          <p className={`font-mono text-[11px] tabular-nums ${tooLong ? "text-danger" : "text-muted"}`}>
            {draft.scenes.length} scenes · {total.toFixed(1)}s / {MAX_SECONDS}s
          </p>
        </div>

        <details className="group rounded-[14px] border-2 border-line px-3 py-2">
          <summary className="label cursor-pointer list-none text-[10px] text-muted marker:hidden">
            Style <span className="text-faint group-open:hidden">· shared by every scene</span>
          </summary>
          <textarea
            value={draft.style}
            onChange={(e) => setDraft({ ...draft, style: e.target.value })}
            disabled={locked}
            rows={5}
            aria-label="Style shared by every scene"
            className="mt-2 w-full resize-y bg-transparent text-[13px] leading-relaxed text-text focus:outline-none disabled:opacity-60"
          />
        </details>

        <ol className="space-y-3">
          {draft.scenes.map((s, i) => (
            <SceneCard
              key={s.id || `new-${i}`}
              index={i}
              scene={s}
              built={s.id ? byId.get(s.id) : undefined}
              status={statusOf(s.id ? byId.get(s.id) : undefined)}
              count={draft.scenes.length}
              locked={locked}
              dirty={dirty}
              clipStart={(() => {
                const built = s.id ? byId.get(s.id) : undefined;
                const clips = project?.timeline.clips ?? [];
                const k = built?.media_id ? clips.findIndex((c) => c.media_id === built.media_id) : -1;
                return k < 0 ? null : clipStarts(clips)[k];
              })()}
              onChange={(patch) => update(i, patch)}
              onMove={(by) => move(i, by)}
              onDelete={() => setDraft((d) => ({ ...d, scenes: d.scenes.filter((_, k) => k !== i) }))}
              onBuild={(note) => buildScenes([s.id], note ? [{ scene_id: s.id, note }] : [])}
            />
          ))}
        </ol>

        <button
          type="button"
          disabled={locked || draft.scenes.length >= 40}
          onClick={() =>
            setDraft((d) => ({ ...d, scenes: [...d.scenes, { id: "", title: "New scene", duration: 3, brief: "", images: [] }] }))
          }
          className="flex w-full items-center justify-center gap-1.5 rounded-[14px] border-2 border-dashed border-line-strong py-2.5 text-[13px] text-muted transition-colors hover:border-text hover:text-text disabled:pointer-events-none disabled:opacity-40"
        >
          <Plus size={14} weight="bold" /> Add a scene
        </button>
      </div>

      <div className="shrink-0 border-t-2 border-edge p-3">
        {dirty ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={locked || tooLong || draft.scenes.some((s) => !s.brief.trim() || !s.title.trim())}
              onClick={() => editStoryboard(draft)}
              className="flex-1 rounded-full border-2 border-ink bg-lime px-4 py-2 text-[13px] font-semibold text-ink transition active:scale-[0.98] disabled:opacity-40"
            >
              Save changes
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => setDraft(editable(board))}
              className="rounded-full border-2 border-edge px-4 py-2 text-[13px] text-text transition hover:bg-raised disabled:opacity-40"
            >
              Discard
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={locked || toBuild.length === 0}
            onClick={() => buildScenes(null)}
            className="flex w-full items-center justify-center gap-2 rounded-full border-2 border-ink bg-pink px-4 py-2 text-[13px] font-semibold text-ink transition active:scale-[0.98] disabled:opacity-40"
          >
            {running ? <CircleNotch size={14} weight="bold" className="animate-spin" /> : <Hammer size={14} weight="bold" />}
            {running
              ? "Building with Muse Wonder"
              : toBuild.length
                ? `Build ${toBuild.length} ${toBuild.length === 1 ? "scene" : "scenes"} · about $${(toBuild.length * COST_PER_SCENE).toFixed(2)}`
                : "Every scene is built"}
          </button>
        )}
        {dirty && <p className="mt-2 text-center text-[11px] text-faint">Save first; changed scenes then need a rebuild.</p>}
      </div>
    </div>
  );
}

const STATUS: Record<StoryScene["status"], { label: string; className: string }> = {
  draft: { label: "Needs build", className: "border-line-strong text-muted" },
  building: { label: "Building", className: "border-ink bg-sun text-ink" },
  ready: { label: "Ready", className: "border-ink bg-lime text-ink" },
  failed: { label: "Failed", className: "border-tomato bg-tomato text-ink" },
};

function SceneCard(props: {
  index: number;
  scene: DraftScene;
  built: StoryScene | undefined;
  status: StoryScene["status"];
  count: number;
  locked: boolean;
  dirty: boolean;
  clipStart: number | null;
  onChange: (patch: Partial<DraftScene>) => void;
  onMove: (by: number) => void;
  onDelete: () => void;
  onBuild: (note: string | null) => void;
}) {
  const { scene, built, index } = props;
  const reduce = useReducedMotion();
  const media = useEditor((s) => (built?.media_id ? s.project?.media.find((m) => m.id === built.media_id) : undefined));
  const seek = useEditor((s) => s.seek);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [showCode, setShowCode] = useState(false);
  const status = STATUS[props.status];
  const canBuild = Boolean(scene.id) && !props.dirty && !props.locked;

  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-[14px] border-2 border-edge bg-card text-card-text shadow-[0_3px_0_0_var(--edge-shadow)]"
    >
      <div className="flex gap-3 p-3">
        <button
          type="button"
          onClick={() => props.clipStart !== null && seek(props.clipStart)}
          disabled={props.clipStart === null}
          title={props.clipStart !== null ? "Show on the timeline" : "Not on the timeline yet"}
          className="relative grid aspect-video w-[96px] shrink-0 place-items-center overflow-hidden rounded-[8px] border-2 border-edge bg-bg"
        >
          {media ? (
            // eslint-disable-next-line @next/next/no-img-element -- thumbnails come from the API host
            <img src={fileUrl(media.thumb_url)} alt="" className="h-full w-full object-cover" />
          ) : (
            <FilmSlate size={18} className="text-faint" />
          )}
          {props.status === "building" && (
            <span className="absolute inset-0 grid place-items-center bg-ink/60">
              <CircleNotch size={18} weight="bold" className="animate-spin text-paper" />
            </span>
          )}
          <span className="absolute top-1 left-1 rounded-[4px] bg-ink px-1 font-mono text-[10px] text-paper">{index + 1}</span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <input
              value={scene.title}
              onChange={(e) => props.onChange({ title: e.target.value })}
              disabled={props.locked}
              maxLength={80}
              aria-label={`Scene ${index + 1} title`}
              className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold focus:outline-none disabled:opacity-80"
            />
            <label className="flex shrink-0 items-center gap-0.5 font-mono text-[11px] text-muted">
              <input
                type="number"
                min={1}
                max={20}
                step={0.5}
                value={scene.duration}
                onChange={(e) => props.onChange({ duration: Number(e.target.value) })}
                disabled={props.locked}
                aria-label={`Scene ${index + 1} length in seconds`}
                className="w-10 bg-transparent text-right tabular-nums focus:outline-none"
              />
              s
            </label>
          </div>
          <span className={`label mt-1 inline-block rounded-full border-2 px-1.5 py-px text-[9px] ${status.className}`}>{status.label}</span>
        </div>
      </div>

      <textarea
        value={scene.brief}
        onChange={(e) => props.onChange({ brief: e.target.value })}
        disabled={props.locked}
        rows={4}
        placeholder={'What is on screen. Put on-screen text in quotes: "Say the edit."'}
        aria-label={`Scene ${index + 1} brief`}
        className="block w-full resize-y border-t-2 border-line bg-transparent px-3 py-2 text-[12.5px] leading-relaxed placeholder:text-faint focus:outline-none disabled:opacity-80"
      />

      {built?.status === "failed" && built.error && (
        <p className="flex gap-1.5 border-t-2 border-line px-3 py-2 text-[11.5px] leading-snug text-danger">
          <WarningCircle size={14} weight="fill" className="mt-px shrink-0" />
          <span className="line-clamp-3">{built.error}</span>
        </p>
      )}

      {noteOpen && (
        <form
          className="flex gap-2 border-t-2 border-line px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return;
            props.onBuild(note.trim());
            setNote("");
            setNoteOpen(false);
          }}
        >
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
            placeholder="e.g. bigger headline, slower entrance"
            aria-label={`Change to scene ${index + 1}`}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] placeholder:text-faint focus:outline-none"
          />
          <button type="submit" disabled={!canBuild || !note.trim()} className="label text-[10px] text-accent disabled:opacity-40">
            Rebuild
          </button>
        </form>
      )}

      {showCode && built?.code && (
        <pre className="max-h-64 overflow-auto border-t-2 border-line bg-bg px-3 py-2 font-mono text-[10.5px] leading-relaxed text-muted">
          {built.code}
        </pre>
      )}

      <div className="flex items-center gap-0.5 border-t-2 border-line px-1.5 py-1">
        <IconButton label="Move up" disabled={props.locked || index === 0} onClick={() => props.onMove(-1)}>
          <ArrowUp size={13} />
        </IconButton>
        <IconButton label="Move down" disabled={props.locked || index === props.count - 1} onClick={() => props.onMove(1)}>
          <ArrowDown size={13} />
        </IconButton>
        <IconButton label="Delete scene" disabled={props.locked || props.count === 1} onClick={props.onDelete}>
          <Trash size={13} />
        </IconButton>
        {built?.code && (
          <IconButton label={showCode ? "Hide code" : "Show code"} onClick={() => setShowCode(!showCode)}>
            <Code size={13} />
          </IconButton>
        )}
        <span className="ml-auto" />
        {built?.code && (
          <IconButton label="Ask for a change" disabled={!canBuild} onClick={() => setNoteOpen(!noteOpen)}>
            <NotePencil size={13} />
          </IconButton>
        )}
        <button
          type="button"
          disabled={!canBuild}
          onClick={() => props.onBuild(null)}
          className="label flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-text transition-colors hover:bg-raised disabled:opacity-35"
        >
          <Hammer size={12} /> {built?.media_id ? "Rebuild" : "Build"}
        </button>
      </div>
    </motion.li>
  );
}

function IconButton(props: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      className="grid size-7 place-items-center rounded-full text-muted transition-colors hover:bg-raised hover:text-text disabled:pointer-events-none disabled:opacity-30"
    >
      {props.children}
    </button>
  );
}

const LENGTHS = [15, 30, 60, 90, 120, 180] as const;

function EmptyStoryboard() {
  const startRun = useEditor((s) => s.startRun);
  const running = useEditor((s) => s.run?.status === "running" || (s.project?.busy ?? false));
  const [brief, setBrief] = useState("");
  const [seconds, setSeconds] = useState<(typeof LENGTHS)[number]>(30);

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!brief.trim()) return;
        startRun(`Make a ${seconds}-second video in code (motion graphics, no footage needed): ${brief.trim()}`);
      }}
    >
      <div>
        <p className="label text-faint">⁞ Made in code</p>
        <p className="display mt-1 text-[30px] leading-none text-text">No footage? Write it.</p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Muse Wonder writes a storyboard, then builds every scene as a Remotion component, renders it and checks its own
          frames. The scenes land on your timeline like any clip. Attach screenshots or a logo in the Agent tab to use them.
        </p>
      </div>
      <textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        rows={6}
        maxLength={1800}
        placeholder="A launch teaser for my app Fieldnote: notes that file themselves. Headline: 'Write it down. Find it later.' Bold, black and orange."
        aria-label="What the video is about"
        className="w-full resize-none rounded-[14px] border-2 border-line bg-transparent px-3 py-2.5 text-[14px] leading-relaxed placeholder:text-faint focus:border-text focus:outline-none"
      />
      <fieldset>
        <legend className="label text-[10px] text-muted">Length</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {LENGTHS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={seconds === s}
              onClick={() => setSeconds(s)}
              className={`rounded-full border-2 border-edge px-3 py-1 font-mono text-[12px] transition-colors ${seconds === s ? "bg-text text-bg" : "hover:bg-raised"}`}
            >
              {s < 60 ? `${s}s` : `${s / 60}m`}
            </button>
          ))}
        </div>
      </fieldset>
      <button
        type="submit"
        disabled={running || !brief.trim()}
        className="mt-auto rounded-full border-2 border-ink bg-pink px-4 py-2.5 text-[14px] font-semibold text-ink transition active:scale-[0.98] disabled:opacity-40"
      >
        {running ? "The agent is working..." : "Write the storyboard"}
      </button>
    </form>
  );
}
