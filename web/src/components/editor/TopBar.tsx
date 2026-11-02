"use client";

import { CircleNotch, Coins, DownloadSimple, Export, FilmSlate } from "@phosphor-icons/react";
import Link from "next/link";
import { fileUrl } from "@/lib/api";
import { useEditor } from "@/lib/store";
import type { Timeline } from "@/lib/timeline";

const ASPECTS: Timeline["aspect"][] = ["16:9", "9:16", "1:1"];

export function TopBar() {
  const project = useEditor((s) => s.project);
  const pending = useEditor((s) => s.pending);
  const applyOps = useEditor((s) => s.applyOps);
  const exportVideo = useEditor((s) => s.exportVideo);
  const run = useEditor((s) => s.run);
  if (!project) return null;

  const { aspect, clips, fps } = project.timeline;
  const exporting = pending === "Mengekspor video";
  const locked = project.busy;

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-panel px-3">
      <Link href="/" className="flex items-center gap-2 text-text">
        <FilmSlate size={18} weight="fill" className="text-accent" />
        <span className="text-sm font-semibold tracking-tight">Auteur Labs</span>
      </Link>
      <span className="h-4 w-px bg-line" />
      <span className="truncate text-sm text-muted">{project.name}</span>

      <div className="ml-auto flex items-center gap-3">
        {pending && !exporting && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <CircleNotch size={12} className="animate-spin" /> {pending}
          </span>
        )}
        <span
          className="flex items-center gap-1.5 font-mono text-[11px] text-muted"
          title="Biaya Meta Model API: Muse Spark, SAM 3.1, Voice Transcribe"
        >
          <Coins size={13} />
          {run ? `run $${run.cost.toFixed(3)} · ` : ""}total ${project.spent.toFixed(2)}
        </span>
        <div role="radiogroup" aria-label="Format video" className="flex rounded-md border border-line-strong p-0.5">
          {ASPECTS.map((a) => (
            <button
              key={a}
              role="radio"
              aria-checked={aspect === a}
              disabled={locked}
              onClick={() => aspect !== a && applyOps(`Format ${a}`, [{ op: "set_aspect", aspect: a }])}
              className={`rounded-[4px] px-2.5 py-1 font-mono text-[11px] transition-colors disabled:opacity-50 ${
                aspect === a ? "bg-raised text-text" : "text-muted hover:text-text"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Frame rate" className="flex rounded-md border border-line-strong p-0.5">
          {([24, 30, 60] as const).map((f) => (
            <button
              key={f}
              role="radio"
              aria-checked={fps === f}
              disabled={locked}
              title={f === 24 ? "24 fps: kesan film" : f === 60 ? "60 fps: gerakan halus" : "30 fps: standar media sosial"}
              onClick={() => fps !== f && applyOps(`${f} fps`, [{ op: "set_fps", fps: f }])}
              className={`rounded-[4px] px-2 py-1 font-mono text-[11px] transition-colors disabled:opacity-50 ${
                fps === f ? "bg-raised text-text" : "text-muted hover:text-text"
              }`}
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
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted transition hover:bg-raised hover:text-text"
          >
            <DownloadSimple size={14} /> Hasil terakhir
          </a>
        )}
        <button
          type="button"
          onClick={exportVideo}
          disabled={locked || exporting || clips.length === 0}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition hover:brightness-110 active:scale-[0.97] disabled:opacity-40"
        >
          {exporting ? <CircleNotch size={14} className="animate-spin" /> : <Export size={14} weight="bold" />}
          {exporting ? "Mengekspor" : "Export"}
        </button>
      </div>
    </header>
  );
}
