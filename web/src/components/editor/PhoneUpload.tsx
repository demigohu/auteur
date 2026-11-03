"use client";

import { CheckCircle, CircleNotch, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { ApiError, api } from "@/lib/api";
import { isUploadable, UPLOAD_ACCEPT } from "@/lib/media";

type Item = { name: string; progress: number; status: "waiting" | "uploading" | "done" | "failed"; error?: string };

/** Phone page behind the editor's QR code. Files upload one at a time; the editor picks them up live. */
export function PhoneUpload({ projectId }: { projectId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getProject(projectId).then(
      (p) => setName(p.name),
      (e) => setError(e instanceof ApiError && e.status === 404 ? "This project doesn't exist or isn't yours." : "Couldn't reach Auteur."),
    );
  }, [projectId]);

  async function send(files: File[]) {
    const queued = files.filter(isUploadable);
    const start = items.length;
    setItems((prev) => [...prev, ...queued.map((f) => ({ name: f.name, progress: 0, status: "waiting" as const }))]);
    const update = (i: number, patch: Partial<Item>) => setItems((prev) => prev.map((it, k) => (k === start + i ? { ...it, ...patch } : it)));
    for (const [i, f] of queued.entries()) {
      update(i, { status: "uploading" });
      try {
        await api.uploadWithProgress(projectId, f, (p) => update(i, { progress: p }));
        update(i, { status: "done", progress: 1 });
      } catch (e) {
        update(i, { status: "failed", error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return (
    <main className="paper-texture min-h-[100dvh] bg-bg px-4 py-6 text-text">
      <div className="mx-auto max-w-md">
        <Logo href="/studio" size="sm" />
        <h1 className="display mt-6 text-[44px] leading-none">Send to the edit.</h1>
        <p className="mt-2 text-[15px] text-muted">{error ?? (name ? `Into “${name}”.` : "Loading the project...")}</p>

        <button
          type="button"
          disabled={Boolean(error) || !name}
          onClick={() => input.current?.click()}
          className="mt-6 flex w-full flex-col items-center gap-2 rounded-[18px] border-2 border-dashed border-line-strong px-4 py-10 text-center transition active:scale-[0.99] disabled:opacity-40"
        >
          <span className="grid size-14 place-items-center rounded-full border-2 border-ink bg-pink text-ink">
            <UploadSimple size={24} weight="bold" />
          </span>
          <span className="text-[17px] font-semibold">Pick videos or photos</span>
          <span className="text-[13px] text-faint">They show up in the editor&apos;s media bin as each one finishes.</span>
        </button>
        <input
          ref={input}
          type="file"
          accept={UPLOAD_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            send(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />

        <ul className="mt-5 space-y-2">
          {items.map((it, i) => (
            <li key={i} className="rounded-[14px] border-2 border-edge bg-card px-3 py-2.5 text-card-text">
              <div className="flex items-center gap-2 text-[14px]">
                {it.status === "done" ? (
                  <CheckCircle size={18} weight="fill" className="shrink-0 text-forest" />
                ) : it.status === "failed" ? (
                  <WarningCircle size={18} weight="fill" className="shrink-0 text-danger" />
                ) : (
                  <CircleNotch size={18} className={`shrink-0 ${it.status === "uploading" ? "animate-spin" : "opacity-40"}`} />
                )}
                <span className="truncate">{it.name}</span>
                <span className="ml-auto font-mono text-[12px] tabular-nums text-muted">
                  {it.status === "uploading" ? (it.progress < 1 ? `${Math.round(it.progress * 100)}%` : "Processing") : it.status === "done" ? "Sent" : it.status === "failed" ? "" : "Waiting"}
                </span>
              </div>
              {it.status === "uploading" && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg">
                  <div className="h-full bg-lime transition-[width]" style={{ width: `${it.progress * 100}%` }} />
                </div>
              )}
              {it.error && <p className="mt-1 text-[12px] text-danger">{it.error}</p>}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
