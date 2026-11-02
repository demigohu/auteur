"use client";

import { Warning, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useEditor } from "@/lib/store";
import { clipDuration, clipStarts } from "@/lib/time";
import { MediaBin } from "./MediaBin";
import { Preview } from "./Preview";
import { SidePanel } from "./SidePanel";
import { TimelinePanel } from "./TimelinePanel";
import { TopBar } from "./TopBar";

export function Editor({ projectId }: { projectId: string }) {
  const project = useEditor((s) => s.project);
  const load = useEditor((s) => s.load);
  const connect = useEditor((s) => s.connect);
  const error = useEditor((s) => s.error);

  useEffect(() => {
    load(projectId);
    return connect(projectId);
  }, [projectId, load, connect]);

  useShortcuts();

  if (!project) return error ? <LoadError message={error} /> : <EditorSkeleton />;

  return (
    // minmax(0,1fr) column: a long timeline must scroll inside its panel, not widen the whole editor.
    <div className="grid h-[100dvh] w-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_260px] overflow-hidden">
      <TopBar />
      <div className="grid min-h-0 grid-cols-[220px_minmax(0,1fr)_360px]">
        <MediaBin />
        <Preview />
        <SidePanel />
      </div>
      <TimelinePanel />
      <ErrorToast />
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
      const s = useEditor.getState();
      if (!s.project || s.project.busy) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (s.selectedClipId) s.applyOps("Hapus klip", [{ op: "delete", clip_id: s.selectedClipId }]);
        else if (s.selectedTextId) s.applyOps("Hapus teks", [{ op: "delete_text", text_id: s.selectedTextId }]);
        else if (s.selectedOverlayId) s.applyOps("Hapus B-roll", [{ op: "delete_overlay", overlay_id: s.selectedOverlayId }]);
        else if (s.selectedAudioId) s.applyOps("Hapus musik", [{ op: "delete_audio", audio_id: s.selectedAudioId }]);
        s.select({});
      } else if (e.key.toLowerCase() === "s" && !mod) {
        const { clips } = s.project.timeline;
        const starts = clipStarts(clips);
        const i = clips.findIndex((c, k) => s.time > starts[k] + 0.1 && s.time < starts[k] + clipDuration(c) - 0.1);
        if (i >= 0) s.applyOps("Potong klip di playhead", [{ op: "split", clip_id: clips[i].id, at: Number(s.time.toFixed(3)) }]);
      } else if (e.key === "Escape") {
        s.select({});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function ErrorToast() {
  const error = useEditor((s) => s.error);
  const clear = useEditor((s) => s.clearError);
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          role="alert"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="fixed bottom-[276px] left-1/2 z-50 flex max-w-lg -translate-x-1/2 items-start gap-2 rounded-md border border-danger/40 bg-panel-2 px-3 py-2 text-sm text-text shadow-xl"
        >
          <Warning size={16} weight="fill" className="mt-0.5 shrink-0 text-danger" />
          <span className="leading-snug">{error}</span>
          <button type="button" aria-label="Tutup" onClick={clear} className="ml-2 shrink-0 text-muted hover:text-text">
            <X size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function EditorSkeleton() {
  return (
    <div className="grid h-[100dvh] w-full grid-cols-[minmax(0,1fr)] grid-rows-[48px_minmax(0,1fr)_260px] overflow-hidden">
      <div className="border-b border-line bg-panel" />
      <div className="grid grid-cols-[220px_minmax(0,1fr)_360px]">
        <div className="space-y-2 border-r border-line bg-panel p-3">
          {[0, 1].map((i) => (
            <div key={i} className="aspect-video animate-pulse rounded-md bg-raised" />
          ))}
        </div>
        <div className="grid place-items-center p-6">
          <div className="aspect-video w-3/4 animate-pulse rounded-md bg-panel-2" />
        </div>
        <div className="border-l border-line bg-panel" />
      </div>
      <div className="border-t border-line bg-panel" />
    </div>
  );
}

function LoadError({ message }: { message: string }) {
  return (
    <div className="grid min-h-[100dvh] place-items-center p-6">
      <div className="max-w-sm">
        <p className="text-sm text-text">Proyek tidak bisa dibuka</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">{message}. Pastikan server API berjalan di port 8000.</p>
      </div>
    </div>
  );
}
