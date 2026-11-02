"use client";

import { CircleNotch, Coins, DownloadSimple, Export } from "@phosphor-icons/react";
import { Logo } from "@/components/ui/Logo";
import { fileUrl } from "@/lib/api";
import { useEditor } from "@/lib/store";
import type { Timeline } from "@/lib/timeline";

const ASPECTS: Timeline["aspect"][] = ["16:9", "9:16", "1:1"];

// Pill segmented control (docs/DESIGN.md, "Segmented control").
const SEGMENTED = "flex rounded-full border-2 border-ink bg-panel p-0.5";
const SEGMENT = "rounded-full py-1 font-mono text-[11px] transition-colors disabled:opacity-50";
const SEGMENT_ON = "bg-ink text-paper";
const SEGMENT_OFF = "text-muted hover:text-text";

export function TopBar() {
  const project = useEditor((s) => s.project);
  const pending = useEditor((s) => s.pending);
  const applyOps = useEditor((s) => s.applyOps);
  const exportVideo = useEditor((s) => s.exportVideo);
  const run = useEditor((s) => s.run);
  if (!project) return null;

  const { aspect, clips, fps } = project.timeline;
  const exporting = pending === "Exporting video";
  const locked = project.busy;

  return (
    <header className="paper-texture relative flex h-14 shrink-0 items-center gap-4 border-b-2 border-ink bg-panel px-3">
      <Logo href="/studio" size="sm" />
      <span className="label hidden text-faint md:inline">Project /</span>
      <span className="truncate font-serif text-[22px] leading-none italic text-text">{project.name}</span>

      <div className="ml-auto flex items-center gap-3">
        {pending && !exporting && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <CircleNotch size={12} className="animate-spin" /> {pending}
          </span>
        )}
        <span
          className="flex items-center gap-1.5 font-mono text-[11px] text-muted"
          title="Meta Model API cost: Muse Spark, SAM 3.1, Voice Transcribe"
        >
          <Coins size={13} />
          {run ? `run $${run.cost.toFixed(3)} · ` : ""}total ${project.spent.toFixed(2)}
        </span>
        <div role="radiogroup" aria-label="Video format" className={SEGMENTED}>
          {ASPECTS.map((a) => (
            <button
              key={a}
              role="radio"
              aria-checked={aspect === a}
              disabled={locked}
              onClick={() => aspect !== a && applyOps(`Format ${a}`, [{ op: "set_aspect", aspect: a }])}
              className={`${SEGMENT} px-2.5 ${aspect === a ? SEGMENT_ON : SEGMENT_OFF}`}
            >
              {a}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Frame rate" className={SEGMENTED}>
          {([24, 30, 60] as const).map((f) => (
            <button
              key={f}
              role="radio"
              aria-checked={fps === f}
              disabled={locked}
              title={f === 24 ? "24 fps: film look" : f === 60 ? "60 fps: smooth motion" : "30 fps: social standard"}
              onClick={() => fps !== f && applyOps(`${f} fps`, [{ op: "set_fps", fps: f }])}
              className={`${SEGMENT} px-2 ${fps === f ? SEGMENT_ON : SEGMENT_OFF}`}
            >
              {f}
            </button>
          ))}
        </div>
        {project.last_render_url && (
          <a
            href={fileUrl(project.last_render_url)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted transition hover:bg-raised hover:text-text"
          >
            <DownloadSimple size={14} /> Latest render
          </a>
        )}
        <button
          type="button"
          onClick={exportVideo}
          disabled={locked || exporting || clips.length === 0}
          className="hard flex h-9 items-center gap-1.5 rounded-full bg-pink px-4 text-[13px] font-semibold text-ink disabled:opacity-40"
        >
          {exporting ? <CircleNotch size={14} className="animate-spin" /> : <Export size={14} weight="bold" />}
          {exporting ? "Exporting" : "Export"}
        </button>
      </div>
    </header>
  );
}
