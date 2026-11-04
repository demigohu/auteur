"use client";

import { Plus, UploadSimple } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { fileUrl, type MediaView } from "@/lib/api";
import { clipLength, groupOf, isUploadable, type MediaGroup, UPLOAD_ACCEPT } from "@/lib/media";
import { useEditor } from "@/lib/store";
import { MoreSources } from "./MoreSources";
import { MEDIA_DRAG_TYPE } from "./TimelinePanel";

const GROUPS: { id: MediaGroup | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "footage", label: "Footage" },
  { id: "pictures", label: "Pictures" },
  { id: "scenes", label: "Scenes" },
  { id: "audio", label: "Audio" },
];

export function MediaBin() {
  const project = useEditor((s) => s.project);
  const upload = useEditor((s) => s.upload);
  const applyOps = useEditor((s) => s.applyOps);
  const pending = useEditor((s) => s.pending);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [group, setGroup] = useState<MediaGroup | "all">("all");
  if (!project) return null;

  const uploading = pending?.startsWith("Uploading") ? pending : null;
  // The footage budget (from the server) counts videos only; pictures and scenes made in code don't (same rule as the API).
  const total = project.media.filter((m) => groupOf(m) === "footage").reduce((s, m) => s + m.duration, 0);
  // Scenes show in storyboard order, latest render only (older renders stay in the project for undo).
  const sceneIndex = new Map((project.storyboard?.scenes ?? []).map((s, i) => [s.media_id, i]));
  const shown = project.media
    .map((m, i) => ({ m, key: m.scene_id ? project.media.length + (sceneIndex.get(m.id) ?? 0) : i }))
    .filter(({ m }) => !m.scene_id || sceneIndex.has(m.id))
    .sort((a, b) => a.key - b.key)
    .map(({ m }) => m);
  const present = new Set(shown.map(groupOf));
  const visible = group === "all" || !present.has(group) ? shown : shown.filter((m) => groupOf(m) === group);
  const pick = (files: FileList | null) =>
    files && upload(Array.from(files).filter(isUploadable));

  return (
    <aside
      className={`flex min-h-0 flex-col border-r-2 border-edge bg-panel transition-colors ${over ? "bg-accent-soft" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        pick(e.dataTransfer.files);
      }}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b-2 border-edge px-3">
        <span className="display text-[20px] text-text">Media</span>
        <span className="font-mono text-[11px] text-faint">{Math.round(total)}s / {Math.round(project.max_footage_seconds)}s</span>
      </div>

      {present.size > 1 && (
        <div role="radiogroup" aria-label="Show media" className="flex shrink-0 flex-wrap gap-1 border-b-2 border-edge px-3 py-2">
          {GROUPS.filter((g) => g.id === "all" || present.has(g.id)).map((g) => (
            <button
              key={g.id}
              role="radio"
              aria-checked={group === g.id}
              onClick={() => setGroup(g.id)}
              className={`rounded-full px-2 py-0.5 font-mono text-[10px] transition-colors ${group === g.id ? "bg-text text-bg" : "text-muted hover:text-text"}`}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {visible.map((m) => (
          <MediaCard
            key={m.id}
            media={m}
            locked={project.busy}
            onAdd={() =>
              m.kind === "audio"
                ? applyOps(`Music: ${m.name}`, [{ op: "add_audio", media_id: m.id }])
                : applyOps(`Add ${m.name}`, [{ op: "add_clip", media_id: m.id, src_in: 0, src_out: clipLength(m) }])
            }
          />
        ))}
        {uploading && <UploadSkeleton label={uploading} />}

        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={Boolean(uploading)}
          className="flex w-full flex-col items-center gap-1.5 rounded-[14px] border-2 border-dashed border-line-strong px-3 py-5 text-center transition hover:border-line-strong hover:bg-raised active:scale-[0.99] disabled:opacity-50"
        >
          <span className="grid size-9 place-items-center rounded-full border-2 border-ink bg-pink text-ink">
            <UploadSimple size={16} weight="bold" />
          </span>
          <span className="text-xs font-semibold text-text">Upload footage, music or pictures</span>
          <span className="text-[11px] text-faint">MP4, MOV, WebM, MP3, WAV, PNG, JPG, GIF. Up to {Math.round(project.max_footage_seconds / 60)} minutes of footage</span>
        </button>
        <MoreSources projectId={project.id} disabled={Boolean(pending)} />
        <input
          ref={input}
          type="file"
          accept={UPLOAD_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </aside>
  );
}

function MediaCard({ media, locked, onAdd }: { media: MediaView; locked: boolean; onAdd: () => void }) {
  const reduce = useReducedMotion();
  const portrait = media.height > media.width;
  const audio = media.kind === "audio";
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="group overflow-hidden rounded-[14px] border-2 border-edge bg-panel-2 shadow-[0_3px_0_0_var(--edge-shadow)]"
    >
      {/* Plain div for HTML5 drag: motion.div reserves onDragStart for its own gestures. */}
      <div
        draggable={!locked}
        onDragStart={(e) => {
          e.dataTransfer.setData(MEDIA_DRAG_TYPE, media.id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        title="Drag to the timeline"
        className="cursor-grab active:cursor-grabbing"
      >
      <div className={`relative overflow-hidden bg-bg ${audio ? "h-12" : "aspect-video"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- thumbnails come from the API host */}
        <img
          src={fileUrl(media.thumb_url)}
          alt={media.name}
          className={`h-full w-full ${portrait || audio ? "object-contain" : "object-cover"}`}
        />
        {(media.scene_id || media.image) && (
          <span className="label absolute top-1.5 left-1.5 rounded-full border-2 border-ink bg-sun px-1.5 py-px text-[9px] text-ink">
            {media.scene_id ? "Code" : media.image === "gif" ? "GIF" : "Picture"}
          </span>
        )}
        <button
          type="button"
          onClick={onAdd}
          disabled={locked}
          aria-label={audio ? `Use ${media.name} as music` : `Add ${media.name} to the timeline`}
          className="absolute right-1.5 bottom-1.5 grid size-7 place-items-center rounded-full border-2 border-ink bg-lime text-ink opacity-0 transition group-hover:opacity-100 hover:bg-pink focus-visible:opacity-100 disabled:hidden"
        >
          <Plus size={14} weight="bold" />
        </button>
      </div>
      <div className="flex items-center gap-2 border-t-2 border-edge px-2.5 py-2">
        <span className="truncate text-xs font-semibold text-text">{media.name}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">{media.image === "still" ? "still" : `${media.duration.toFixed(1)}s`}</span>
      </div>
      </div>
    </motion.div>
  );
}

function UploadSkeleton({ label }: { label: string }) {
  return (
    <div className="overflow-hidden rounded-[14px] border-2 border-edge bg-panel-2">
      <div className="aspect-video animate-pulse bg-raised" />
      <p className="truncate px-2.5 py-2 text-xs text-muted">{label}</p>
    </div>
  );
}
