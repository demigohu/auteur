"use client";

import { FilmStrip, MusicNotes, UploadSimple, X } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/ui/form";
import { ApiError, api, type NewProject } from "@/lib/api";
import { ASPECTS, AspectGlyph } from "./aspects";

export type Draft = { name: string; aspect: NewProject["aspect"]; fps: NewProject["fps"]; brief: string; files: File[] };

export const EMPTY_DRAFT: Draft = { name: "", aspect: "16:9", fps: 30, brief: "", files: [] };

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Where a brief waits for the editor to pick it up (AgentTab prefills its input from it). */
export const briefKey = (projectId: string) => `auteur:brief:${projectId}`;

export function untitled(files: File[] = []): string {
  const first = files.find((f) => f.type.startsWith("video/"));
  return first ? first.name.replace(/\.[^.]+$/, "") : `Untitled ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** New project: name, format, frame rate, optional footage and an optional first brief for the agent. */
export function CreateProjectDialog({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {draft && (
        <motion.div
          className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-ink/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-title"
            initial={reduce ? false : { y: 40, scale: 0.96, rotate: -1.5 }}
            animate={{ y: 0, scale: 1, rotate: 0 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.5, ease: EASE_OUT }}
            className="paper-texture my-8 w-full max-w-[640px] rounded-[22px] border-2 border-edge bg-card text-text shadow-[10px_10px_0_0_var(--edge-shadow)]"
          >
            {/* Remount per opening so the form starts from the draft it was opened with. */}
            <DialogBody key={`${draft.aspect}-${draft.brief}`} draft={draft} onClose={onClose} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DialogBody({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [aspect, setAspect] = useState(draft.aspect);
  const [fps, setFps] = useState(draft.fps);
  const [files, setFiles] = useState<File[]>(draft.files);
  const [over, setOver] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !status && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, status]);

  const addFiles = (list: FileList | File[]) => {
    const media = Array.from(list).filter((f) => f.type.startsWith("video/") || f.type.startsWith("audio/"));
    if (media.length < Array.from(list).length) setError("Only video (MP4, MOV) and audio (MP3, WAV) files can go in.");
    setFiles((prev) => [...prev, ...media]);
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim() || untitled(files);
    const brief = String(form.get("brief") ?? "").trim();
    setError(null);
    try {
      setStatus("Creating project");
      const project = await api.createProject({ name, aspect, fps });
      // Music last, so the footage is in the bin first; uploads run one at a time to keep memory flat.
      const ordered = [...files].sort((a, b) => Number(a.type.startsWith("audio/")) - Number(b.type.startsWith("audio/")));
      for (const [i, f] of ordered.entries()) {
        setStatus(`Uploading ${i + 1} of ${ordered.length}`);
        await api.upload(project.id, f);
      }
      if (brief) {
        try {
          sessionStorage.setItem(briefKey(project.id), brief);
        } catch {}
      }
      router.push(`/p/${project.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Is the API running on port 8000?");
      setStatus(null);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="p-7 sm:p-9">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label text-faint">⁞ New project</p>
          <h2 id="new-project-title" className="display mt-3 text-[56px]">
            Roll camera.
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={Boolean(status)}
          aria-label="Close"
          className="grid size-10 place-items-center rounded-full border-2 border-edge transition-colors hover:bg-text hover:text-bg disabled:opacity-40"
        >
          <X size={16} weight="bold" />
        </button>
      </div>

      <label className="mt-7 block">
        <span className="label text-[10px] text-muted">Project name</span>
        <input
          name="name"
          defaultValue={draft.name}
          autoFocus
          maxLength={100}
          placeholder={untitled(files)}
          className="mt-1.5 w-full border-b-2 border-line bg-transparent py-2 text-[20px] font-semibold placeholder:font-normal placeholder:text-faint focus:border-text focus:outline-none"
        />
      </label>

      <fieldset className="mt-7">
        <legend className="label text-[10px] text-muted">Format</legend>
        <div className="mt-2 grid grid-cols-3 gap-3">
          {ASPECTS.map((a) => (
            <button
              key={a.value}
              type="button"
              aria-pressed={aspect === a.value}
              onClick={() => setAspect(a.value)}
              className={`flex flex-col items-center gap-2 rounded-[14px] border-2 border-edge px-2 py-4 transition-[background-color,box-shadow,transform] duration-200 ${
                aspect === a.value ? "bg-text text-bg shadow-[0_4px_0_0_var(--tomato)]" : "hover:-translate-y-0.5 hover:bg-raised"
              }`}
            >
              <AspectGlyph aspect={a.value} active={aspect === a.value} />
              <span className="display text-[22px]">{a.value}</span>
              <span className={`text-center text-[12px] leading-tight ${aspect === a.value ? "text-bg/70" : "text-muted"}`}>{a.use}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="label text-[10px] text-muted">Frame rate</legend>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {([24, 30, 60] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={fps === f}
              onClick={() => setFps(f)}
              className={`rounded-full border-2 border-edge px-3.5 py-1.5 font-mono text-[12px] transition-colors ${fps === f ? "bg-text text-bg" : "hover:bg-raised"}`}
            >
              {f} fps
            </button>
          ))}
          <span className="text-[13px] text-faint">{fps === 24 ? "Film look" : fps === 60 ? "Smooth motion, slow-mo" : "Standard for social"}</span>
        </div>
      </fieldset>

      <div className="mt-6">
        <p className="label text-[10px] text-muted">Footage and music (optional)</p>
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`mt-2 flex w-full items-center gap-4 rounded-[14px] border-2 border-dashed px-4 py-4 text-left transition-colors ${
            over ? "border-ink bg-lime/40" : "border-line-strong hover:border-text hover:bg-raised"
          }`}
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-ink bg-pink">
            <UploadSimple size={18} weight="bold" />
          </span>
          <span>
            <span className="block text-[15px] font-semibold">Drop clips here, or browse</span>
            <span className="block text-[13px] text-muted">MP4 or MOV footage, up to 5 minutes in total. MP3 or WAV for music. You can add more later.</span>
          </span>
        </button>
        <input
          ref={input}
          type="file"
          accept="video/mp4,video/quicktime,audio/*"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files ?? []);
            e.target.value = "";
          }}
        />
        {files.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded-full border-2 border-edge bg-card py-1 pr-1 pl-3 text-[13px]">
                {f.type.startsWith("audio/") ? <MusicNotes size={13} /> : <FilmStrip size={13} />}
                <span className="max-w-[180px] truncate">{f.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles(files.filter((_, k) => k !== i))}
                  className="grid size-5 place-items-center rounded-full hover:bg-text hover:text-bg"
                >
                  <X size={10} weight="bold" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="mt-6 block">
        <span className="label text-[10px] text-muted">First brief for the agent (optional)</span>
        <textarea
          name="brief"
          rows={3}
          defaultValue={draft.brief}
          placeholder="Make it a 30-second vlog, cut on the beat, warm grade."
          className="mt-2 w-full resize-none rounded-[14px] border-2 border-line bg-transparent px-3 py-2.5 text-[15px] leading-relaxed placeholder:text-faint focus:border-text focus:outline-none"
        />
      </label>

      {error && (
        <p role="alert" className="mt-4 rounded-[10px] border-2 border-ink bg-sun px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
        <SubmitButton busy={Boolean(status)}>{status ?? (files.length ? "Create project" : "Create blank project")}</SubmitButton>
        <p className="rotate-[-3deg] font-hand text-[20px] text-muted">{files.length ? "the agent can start right away." : "footage can come later, too."}</p>
      </div>
    </form>
  );
}
