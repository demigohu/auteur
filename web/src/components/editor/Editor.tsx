"use client";

import { Warning, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useTheme } from "@/lib/theme";
import { useEditor } from "@/lib/store";
import { clipDuration, clipStarts, stepTime, timelineDuration } from "@/lib/time";
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
  const night = useTheme() === "night";

  if (!project) return error ? <LoadError message={error} /> : <EditorSkeleton night={night} />;

  return (
    // minmax(0,1fr) column: a long timeline must scroll inside its panel, not widen the whole editor.
    <div
      className={`${night ? "theme-night" : ""} grid h-[100dvh] w-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_320px] overflow-hidden bg-bg text-text`}
    >
      <TopBar />
      {/* Night: dark panels around an even darker stage and timeline. Day: everything on paper, the stage a
          neutral light grey. */}
      <div className="grid min-h-0 grid-cols-[220px_minmax(0,1fr)_360px]">
        <MediaBin />
        <div className={`${night ? "theme-ink" : ""} min-w-0`}>
          <Preview />
        </div>
        <SidePanel />
      </div>
      <div className={`${night ? "theme-ink" : ""} min-h-0 border-t-2 border-edge`}>
        <TimelinePanel />
      </div>
      <ErrorToast />
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
      const s = useEditor.getState();
      if (!s.project) return;
      // Moving the playhead changes nothing, so it works while the agent edits too.
      const { fps, clips } = s.project.timeline;
      const duration = timelineDuration(clips);
      const step = { ArrowLeft: -1, ",": -1, ArrowRight: 1, ".": 1 }[e.key];
      if (step && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        s.seek(stepTime(s.time, fps, e.shiftKey ? step * Math.round(fps) : step, duration));
        return;
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        s.seek(e.key === "Home" ? 0 : stepTime(duration, fps, 0, duration));
        return;
      }
      if (s.project.busy) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        s.deleteSelection();
      } else if (mod && e.key.toLowerCase() === "c") {
        s.copyClips();
      } else if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        s.pasteClips();
      } else if (e.key.toLowerCase() === "s" && !mod) {
        const { clips } = s.project.timeline;
        const starts = clipStarts(clips);
        const i = clips.findIndex((c, k) => s.time > starts[k] + 0.1 && s.time < starts[k] + clipDuration(c) - 0.1);
        if (i >= 0) s.applyOps("Split clip at playhead", [{ op: "split", clip_id: clips[i].id, at: Number(s.time.toFixed(3)) }]);
      } else if (mod && e.key.toLowerCase() === "d" && s.selectedClipId) {
        e.preventDefault();
        s.applyOps("Duplicate clip", [{ op: "duplicate_clip", clip_id: s.selectedClipId }]);
      } else if (e.key.toLowerCase() === "t" && !mod) {
        const t = Number(s.time.toFixed(2));
        s.applyOps("Add text", [{ op: "add_text", text: "Title", start: t, end: Number((t + 2).toFixed(2)), style: "title", y: 0.2 }]);
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
          className="fixed bottom-[336px] left-1/2 z-50 flex max-w-lg -translate-x-1/2 items-start gap-2 rounded-[10px] border-2 border-ink bg-sun px-3 py-2 text-sm text-ink shadow-[0_4px_0_0_var(--ink)]"
        >
          <Warning size={16} weight="fill" className="mt-0.5 shrink-0 text-tomato" />
          <span className="leading-snug">{error}</span>
          <button type="button" aria-label="Close" onClick={clear} className="ml-2 shrink-0 text-ink/60 hover:text-ink">
            <X size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function EditorSkeleton({ night = true }: { night?: boolean }) {
  return (
    <div className={`${night ? "theme-night" : ""} grid h-[100dvh] w-full grid-cols-[minmax(0,1fr)] grid-rows-[56px_minmax(0,1fr)_320px] overflow-hidden bg-bg`}>
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
        <p className="text-sm text-text">This project couldn&apos;t be opened</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">{message}. Make sure the API server is running on port 8000.</p>
      </div>
    </div>
  );
}
