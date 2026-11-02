"use client";

import { ArrowRight, CircleNotch, FilmSlate, UploadSimple } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, type ProjectSummary } from "@/lib/api";

export function Home() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const input = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setError("Server API belum berjalan di port 8000."));
  }, []);

  async function start(files: File[]) {
    const videos = files.filter((f) => f.type.startsWith("video/"));
    if (!videos.length) return setError("Pilih file video MP4 atau MOV.");
    setError(null);
    try {
      setStatus("Membuat proyek");
      const name = videos[0].name.replace(/\.[^.]+$/, "");
      const p = await api.createProject(name);
      for (const [i, f] of videos.entries()) {
        setStatus(`Mengunggah ${i + 1} dari ${videos.length}`);
        await api.upload(p.id, f);
      }
      router.push(`/p/${p.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    }
  }

  const enter = (i: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { delay: i * 0.06, duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } };

  return (
    <main className="mx-auto grid min-h-[100dvh] w-full max-w-6xl grid-cols-1 gap-12 px-4 py-12 md:grid-cols-[1.1fr_1fr] md:items-center md:px-8">
      <div>
        <motion.div {...enter(0)} className="flex items-center gap-2">
          <FilmSlate size={22} weight="fill" className="text-accent" />
          <span className="text-sm font-semibold tracking-tight">Auteur Labs</span>
        </motion.div>
        <motion.h1 {...enter(1)} className="mt-8 text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">
          Editor video yang bisa kamu ajak bicara.
        </motion.h1>
        <motion.p {...enter(2)} className="mt-5 max-w-[46ch] text-base leading-relaxed text-muted">
          Unggah footage mentah, beri arahan seperti ke editor manusia. Agen menonton, mendengar, lalu menyusun timeline yang tetap bisa kamu ubah.
        </motion.p>

        <motion.div {...enter(3)} className="mt-10">
          <p className="text-xs font-medium text-muted">Proyek terakhir</p>
          <div className="mt-3 space-y-1">
            {projects === null && !error && [0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-panel-2" />)}
            {projects?.length === 0 && <p className="text-sm text-faint">Belum ada proyek.</p>}
            {projects?.slice(0, 6).map((p) => (
              <Link
                key={p.id}
                href={`/p/${p.id}`}
                className="group flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-panel-2"
              >
                <span className="truncate text-sm text-text">{p.name}</span>
                <span className="ml-auto shrink-0 text-xs text-faint">
                  {new Date(p.updated_at).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                </span>
                <ArrowRight size={14} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-text" />
              </Link>
            ))}
          </div>
        </motion.div>
      </div>

      <motion.div {...enter(2)}>
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
            start(Array.from(e.dataTransfer.files));
          }}
          disabled={Boolean(status)}
          className={`flex aspect-[4/5] w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed p-8 text-center transition ${
            over ? "border-accent bg-accent-soft" : "border-line-strong bg-panel hover:border-accent/50"
          }`}
        >
          {status ? (
            <>
              <CircleNotch size={24} className="animate-spin text-accent" />
              <span className="text-sm text-text">{status}</span>
              <span className="text-xs text-muted">Menyiapkan preview dan thumbnail</span>
            </>
          ) : (
            <>
              <span className="grid size-12 place-items-center rounded-md bg-raised">
                <UploadSimple size={20} className="text-text" />
              </span>
              <span className="text-sm font-medium text-text">Tarik footage ke sini</span>
              <span className="max-w-[28ch] text-xs leading-relaxed text-muted">
                Satu atau beberapa klip MP4 atau MOV, total maksimal 5 menit. Proyek baru langsung dibuat.
              </span>
            </>
          )}
        </button>
        <input
          ref={input}
          type="file"
          accept="video/mp4,video/quicktime"
          multiple
          hidden
          onChange={(e) => start(Array.from(e.target.files ?? []))}
        />
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </motion.div>
    </main>
  );
}
