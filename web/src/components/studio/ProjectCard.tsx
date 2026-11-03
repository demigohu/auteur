"use client";

import { DotsThree, FilmSlate, PencilSimple, Trash } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fileUrl, type ProjectSummary } from "@/lib/api";
import { clock, timeAgo } from "@/lib/format";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export function ProjectCard(props: {
  project: ProjectSummary;
  index: number;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
}) {
  const { project: p } = props;
  const reduce = useReducedMotion();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const portrait = p.aspect === "9:16" || p.aspect === "4:5";

  return (
    <motion.article
      initial={reduce ? false : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(props.index, 8) * 0.05, duration: 0.6, ease: EASE_OUT }}
      className="group relative rounded-[18px] border-2 border-edge bg-card shadow-[0_4px_0_0_var(--edge-shadow)] transition-[transform,box-shadow] duration-300 ease-[var(--ease-out)] hover:-translate-y-1 hover:shadow-[0_8px_0_0_var(--edge-shadow)]"
    >
      <Link href={`/p/${p.id}`} className="block rounded-[16px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-tomato">
        <div className="mat relative aspect-video overflow-hidden rounded-t-[16px] border-b-2 border-edge">
          {p.thumb_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- thumbnails come from the API host
            <img
              src={fileUrl(p.thumb_url)}
              alt=""
              className={`h-full w-full transition-transform duration-700 ease-[var(--ease-out)] group-hover:scale-[1.04] ${portrait ? "object-contain" : "object-cover"}`}
            />
          ) : (
            <div className="grid h-full place-items-center text-paper/40">
              <div className="flex flex-col items-center gap-2">
                <FilmSlate size={28} />
                <span className="label text-[10px]">No footage yet</span>
              </div>
            </div>
          )}
          <span className="label absolute top-2.5 left-2.5 rounded-full bg-paper px-2 py-0.5 text-[10px] text-ink">{p.aspect}</span>
          {p.duration > 0 && (
            <span className="absolute right-2.5 bottom-2.5 rounded-full bg-ink/85 px-2 py-0.5 font-mono text-[11px] text-paper tabular-nums">
              {clock(p.duration)}
            </span>
          )}
        </div>
        <div className="px-4 pt-3 pb-4 pr-12">
          {renaming ? (
            <span className="block h-[22px]" />
          ) : (
            <h3 className="truncate text-[16px] font-semibold tracking-[-0.01em]">{p.name}</h3>
          )}
          <p className="mt-1 text-[13px] text-muted">
            Edited {timeAgo(p.updated_at).toLowerCase()} · {p.clips} {p.clips === 1 ? "clip" : "clips"} · {p.fps} fps
          </p>
        </div>
      </Link>

      {renaming && (
        <form
          className="absolute top-[calc(56.25%+10px)] right-12 left-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
            if (name && name !== p.name) await props.onRename(name);
            setRenaming(false);
          }}
        >
          <input
            name="name"
            defaultValue={p.name}
            autoFocus
            maxLength={100}
            aria-label="Project name"
            onBlur={(e) => e.currentTarget.form?.requestSubmit()}
            onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
            className="w-full border-b-2 border-edge bg-transparent py-0.5 text-[16px] font-semibold focus:outline-none"
          />
        </form>
      )}

      <div ref={menuRef} className="absolute right-2.5 bottom-[18px]">
        <button
          type="button"
          aria-label={`Options for ${p.name}`}
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
          className="grid size-8 place-items-center rounded-full transition-colors hover:bg-text hover:text-bg"
        >
          <DotsThree size={20} weight="bold" />
        </button>
        {menu && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="absolute right-0 bottom-10 z-20 w-40 overflow-hidden rounded-[12px] border-2 border-edge bg-card py-1 shadow-[0_4px_0_0_var(--edge-shadow)]"
          >
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenu(false);
                setRenaming(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] hover:bg-lime"
            >
              <PencilSimple size={15} /> Rename
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenu(false);
                props.onDelete();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] text-tomato hover:bg-tomato hover:text-ink"
            >
              <Trash size={15} /> Delete
            </button>
          </motion.div>
        )}
      </div>
    </motion.article>
  );
}

export function ProjectCardSkeleton() {
  return (
    <div className="rounded-[18px] border-2 border-line">
      <div className="aspect-video animate-pulse rounded-t-[16px] bg-raised" />
      <div className="space-y-2 px-4 pt-3 pb-4">
        <div className="h-4 w-2/3 animate-pulse rounded-full bg-raised" />
        <div className="h-3 w-1/2 animate-pulse rounded-full bg-raised" />
      </div>
    </div>
  );
}
