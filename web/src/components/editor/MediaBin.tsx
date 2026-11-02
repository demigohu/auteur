"use client";

import { Plus, UploadSimple } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { fileUrl, type MediaView } from "@/lib/api";
import { useEditor } from "@/lib/store";
import { MEDIA_DRAG_TYPE } from "./TimelinePanel";

export function MediaBin() {
  const project = useEditor((s) => s.project);
  const upload = useEditor((s) => s.upload);
  const applyOps = useEditor((s) => s.applyOps);
  const pending = useEditor((s) => s.pending);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  if (!project) return null;

  const uploading = pending?.startsWith("Mengunggah") ? pending : null;
  const total = project.media.filter((m) => m.kind === "video").reduce((s, m) => s + m.duration, 0);
  const pick = (files: FileList | null) =>
    files && upload(Array.from(files).filter((f) => f.type.startsWith("video/") || f.type.startsWith("audio/")));

  return (
    <aside
      className={`flex min-h-0 flex-col border-r border-line bg-panel transition-colors ${over ? "bg-accent-soft" : ""}`}
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
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-[13px] text-text">Media</span>
        <span className="font-mono text-[11px] text-faint">{Math.round(total)}s / 300s</span>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {project.media.map((m) => (
          <MediaCard
            key={m.id}
            media={m}
            locked={project.busy}
            onAdd={() =>
              m.kind === "audio"
                ? applyOps(`Musik ${m.name}`, [{ op: "add_audio", media_id: m.id }])
                : applyOps(`Tambah ${m.name}`, [{ op: "add_clip", media_id: m.id, src_in: 0, src_out: Number(m.duration.toFixed(3)) }])
            }
          />
        ))}
        {uploading && <UploadSkeleton label={uploading} />}

        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={Boolean(uploading)}
          className="flex w-full flex-col items-center gap-1.5 rounded-md border border-dashed border-line-strong px-3 py-5 text-center transition hover:border-accent/60 hover:bg-raised active:scale-[0.99] disabled:opacity-50"
        >
          <UploadSimple size={18} className="text-muted" />
          <span className="text-xs text-text">Unggah footage atau musik</span>
          <span className="text-[11px] text-faint">MP4, MOV, MP3, WAV. Footage total maks 5 menit</span>
        </button>
        <input
          ref={input}
          type="file"
          accept="video/mp4,video/quicktime,audio/*"
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
      className="group overflow-hidden rounded-md border border-line bg-panel-2"
    >
      {/* Plain div for HTML5 drag: motion.div reserves onDragStart for its own gestures. */}
      <div
        draggable={!locked}
        onDragStart={(e) => {
          e.dataTransfer.setData(MEDIA_DRAG_TYPE, media.id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        title="Tarik ke timeline"
        className="cursor-grab active:cursor-grabbing"
      >
      <div className={`relative overflow-hidden bg-bg ${audio ? "h-12" : "aspect-video"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- thumbnails come from the API host */}
        <img
          src={fileUrl(media.thumb_url)}
          alt={media.name}
          className={`h-full w-full ${portrait || audio ? "object-contain" : "object-cover"}`}
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={locked}
          aria-label={audio ? `Pakai ${media.name} sebagai musik` : `Tambah ${media.name} ke timeline`}
          className="absolute right-1.5 bottom-1.5 grid size-7 place-items-center rounded-md bg-bg/80 text-text opacity-0 backdrop-blur transition group-hover:opacity-100 hover:bg-accent hover:text-accent-ink focus-visible:opacity-100 disabled:hidden"
        >
          <Plus size={14} weight="bold" />
        </button>
      </div>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className="truncate text-xs text-text">{media.name}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">{media.duration.toFixed(1)}s</span>
      </div>
      </div>
    </motion.div>
  );
}

function UploadSkeleton({ label }: { label: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-panel-2">
      <div className="aspect-video animate-pulse bg-raised" />
      <p className="truncate px-2.5 py-2 text-xs text-muted">{label}</p>
    </div>
  );
}
