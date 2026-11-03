"use client";

import { CircleNotch, DownloadSimple, Export, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { type ExportFormat, type ExportQuality, fileUrl } from "@/lib/api";
import { useEditor } from "@/lib/store";
import { timelineDuration } from "@/lib/time";

const FORMATS: { id: ExportFormat; label: string; note: string }[] = [
  { id: "mp4", label: "Video", note: "MP4 · H.264 + AAC" },
  { id: "gif", label: "GIF", note: `Silent loop, ${15} fps, up to 60 s` },
  { id: "mp3", label: "Audio", note: "MP3 of the whole soundtrack" },
];
const RESOLUTIONS: Record<ExportFormat, number[]> = { mp4: [480, 720, 1080, 1440, 2160], gif: [360, 480, 720], mp3: [] };
const QUALITIES: { id: ExportQuality; label: string; note: string }[] = [
  { id: "draft", label: "Draft", note: "fast, smaller file" },
  { id: "standard", label: "Standard", note: "for sharing" },
  { id: "high", label: "High", note: "slower, for archiving" },
];
const FRAME_RATES = [24, 25, 30, 50, 60] as const;

const SEGMENTED = "flex flex-wrap rounded-full border-2 border-edge bg-panel p-0.5";
const SEGMENT = "rounded-full px-2.5 py-1 font-mono text-[11px] transition-colors disabled:opacity-40";
const on = (active: boolean) => (active ? "bg-text text-bg" : "text-muted hover:text-text");

const resolutionLabel = (r: number) => (r === 2160 ? "4K" : `${r}p`);

/** Output size for a short side of `short` pixels at the project's aspect. */
function frameSize(aspect: string, short: number): [number, number] {
  const [w, h] = aspect.split(":").map(Number);
  const even = (v: number) => Math.round(v / 2) * 2;
  return w >= h ? [even((short * w) / h), short] : [short, even((short * h) / w)];
}

/** The Export button and its dialog: format, size, quality and frame rate, then progress, cancel and download. */
export function ExportMenu() {
  const project = useEditor((s) => s.project);
  const startExport = useEditor((s) => s.startExport);
  const cancelExport = useEditor((s) => s.cancelExport);
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const [resolution, setResolution] = useState(1080);
  const [quality, setQuality] = useState<ExportQuality>("standard");
  const [fps, setFps] = useState<number | null>(null);
  const [mbps, setMbps] = useState<number | null>(null); // null: the quality preset decides
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!project) return null;
  const job = project.export;
  const running = job?.status === "running";
  const { aspect, clips } = project.timeline;
  const tooLongForGif = timelineDuration(clips) > 60;
  const limit = project.max_export_height;
  const sizes = RESOLUTIONS[format].filter((r) => !limit || r <= limit);
  const size = sizes.includes(resolution) ? resolution : sizes.at(-1) ?? 1080;
  const [w, h] = frameSize(aspect, size);

  const pickFormat = (f: ExportFormat) => {
    setFormat(f);
    if (f === "gif" && resolution > 720) setResolution(480);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={clips.length === 0 && !job}
        aria-expanded={open}
        className="hard flex h-9 items-center gap-1.5 rounded-full bg-pink px-4 text-[13px] font-semibold text-ink tabular-nums disabled:opacity-40"
      >
        {running ? <CircleNotch size={14} className="animate-spin" /> : <Export size={14} weight="bold" />}
        {running ? `Exporting ${Math.round(job.progress * 100)}%` : "Export"}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Export"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className="absolute top-11 right-0 z-50 w-[340px] rounded-[16px] border-2 border-edge bg-card p-4 text-card-text shadow-[0_6px_0_0_var(--edge-shadow)]"
          >
            <div className="flex items-center justify-between">
              <p className="display text-[24px] leading-none">Export</p>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="grid size-7 place-items-center rounded-full hover:bg-raised">
                <X size={13} weight="bold" />
              </button>
            </div>

            {running ? (
              <div className="mt-4">
                <p className="text-[13px] text-muted">
                  {job.format === "mp3" ? "Audio" : job.format === "gif" ? `GIF ${resolutionLabel(job.resolution)}` : `${resolutionLabel(job.resolution)} video`}
                  {" · "}you can keep editing; this exports the timeline as it was when you started.
                </p>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full border-2 border-edge bg-bg" role="progressbar" aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-lime transition-[width] duration-300" style={{ width: `${job.progress * 100}%` }} />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="font-mono text-[12px] tabular-nums text-muted">{Math.round(job.progress * 100)}%</span>
                  <button type="button" onClick={cancelExport} className="rounded-full border-2 border-edge px-3 py-1 text-[12px] hover:bg-raised">
                    Cancel export
                  </button>
                </div>
              </div>
            ) : (
              <>
                <Field label="Format">
                  <div className={SEGMENTED}>
                    {FORMATS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        aria-pressed={format === f.id}
                        disabled={f.id === "gif" && tooLongForGif}
                        title={f.id === "gif" && tooLongForGif ? "GIFs go up to 60 seconds" : undefined}
                        onClick={() => pickFormat(f.id)}
                        className={`${SEGMENT} ${on(format === f.id)}`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-faint">{FORMATS.find((f) => f.id === format)!.note}</p>
                </Field>

                {format !== "mp3" && (
                  <Field label="Resolution">
                    <div className={SEGMENTED}>
                      {sizes.map((r) => (
                        <button key={r} type="button" aria-pressed={size === r} onClick={() => setResolution(r)} className={`${SEGMENT} ${on(size === r)}`}>
                          {resolutionLabel(r)}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-faint">
                      {w}×{h}
                      {size > 1080 ? " · slow to render; sharper only where the footage is bigger than 1080p" : ""}
                      {limit && format === "mp4" && limit < 2160 ? ` · this server exports up to ${resolutionLabel(limit)}` : ""}
                    </p>
                  </Field>
                )}

                {format !== "gif" && (
                  <Field label="Quality">
                    <div className={SEGMENTED}>
                      {QUALITIES.map((q) => (
                        <button key={q.id} type="button" aria-pressed={quality === q.id} onClick={() => setQuality(q.id)} className={`${SEGMENT} ${on(quality === q.id)}`}>
                          {q.label}
                        </button>
                      ))}
                    </div>
                    {format === "mp4" && (
                      <label className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                        <input type="checkbox" checked={mbps !== null} onChange={(e) => setMbps(e.target.checked ? 8 : null)} />
                        Set the bitrate
                        {mbps !== null && (
                          <span className="ml-auto flex items-center gap-1">
                            <input
                              type="number"
                              min={0.5}
                              max={100}
                              step={0.5}
                              value={mbps}
                              onChange={(e) => setMbps(Math.min(100, Math.max(0.5, Number(e.target.value) || 0.5)))}
                              aria-label="Video bitrate in megabits per second"
                              className="w-14 rounded-[6px] border-2 border-line bg-transparent px-1 py-0.5 text-right font-mono tabular-nums focus:border-text focus:outline-none"
                            />
                            Mbps
                          </span>
                        )}
                      </label>
                    )}
                    <p className="mt-1 text-[11px] text-faint">
                      {mbps !== null && format === "mp4"
                        ? `About ${((mbps * timelineDuration(clips)) / 8).toFixed(0)} MB for this video; the preset still sets the encoding speed.`
                        : QUALITIES.find((q) => q.id === quality)!.note}
                    </p>
                  </Field>
                )}

                {format === "mp4" && (
                  <Field label="Frame rate">
                    <div className={SEGMENTED}>
                      <button type="button" aria-pressed={fps === null} onClick={() => setFps(null)} className={`${SEGMENT} ${on(fps === null)}`}>
                        Project ({project.timeline.fps})
                      </button>
                      {FRAME_RATES.map((f) => (
                        <button key={f} type="button" aria-pressed={fps === f} onClick={() => setFps(f)} className={`${SEGMENT} ${on(fps === f)}`}>
                          {f}
                        </button>
                      ))}
                    </div>
                  </Field>
                )}

                {job && job.status !== "running" && (
                  <div className={`mt-4 rounded-[10px] border-2 px-3 py-2 text-[12px] ${job.status === "done" ? "border-ink bg-lime text-ink" : "border-tomato bg-tomato/10 text-text"}`}>
                    {job.status === "done" && job.url ? (
                      <a href={fileUrl(job.url)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-semibold">
                        <DownloadSimple size={14} weight="bold" /> Download the last export ({job.format === "mp3" ? "MP3" : job.format === "gif" ? "GIF" : resolutionLabel(job.resolution)})
                      </a>
                    ) : job.status === "cancelled" ? (
                      "Export cancelled."
                    ) : (
                      <span className="line-clamp-3">Export failed: {job.error}</span>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  disabled={clips.length === 0}
                  onClick={async () => {
                    await startExport({
                      format, resolution: format === "mp3" ? 1080 : size, quality, fps: format === "mp4" ? fps : null,
                      mbps: format === "mp4" ? mbps : null,
                    });
                  }}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border-2 border-ink bg-pink px-4 py-2 text-[13px] font-semibold text-ink transition active:scale-[0.98] disabled:opacity-40"
                >
                  <Export size={14} weight="bold" /> Export {format === "mp3" ? "audio" : format === "gif" ? "GIF" : resolutionLabel(size)}
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="label mb-1.5 text-[10px] text-muted">{label}</p>
      {children}
    </div>
  );
}
