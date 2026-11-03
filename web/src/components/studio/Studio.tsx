"use client";

import {
  ArrowSquareOut,
  FolderSimple,
  House,
  MagicWand,
  MagnifyingGlass,
  Plus,
  SignOut,
  UploadSimple,
  Warning,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useClerk, useUser } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { ApiError, api, type NewProject, type ProjectSummary } from "@/lib/api";
import { greeting } from "@/lib/format";
import { ASPECTS, AspectGlyph } from "./aspects";
import { CreateProjectDialog, type Draft, EMPTY_DRAFT, untitled } from "./CreateProjectDialog";
import { ProjectCard, ProjectCardSkeleton } from "./ProjectCard";
import { RECIPES, type Recipe } from "./recipes";

type View = "home" | "projects" | "recipes";
type Sort = "recent" | "name";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const NAV: { id: View; label: string; icon: typeof House }[] = [
  { id: "home", label: "Home", icon: House },
  { id: "projects", label: "Projects", icon: FolderSimple },
  { id: "recipes", label: "Recipes", icon: MagicWand },
];

/** Reads a dropped clip's orientation so a new project starts in the format the footage was shot in. */
function aspectOf(file: File): Promise<NewProject["aspect"]> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (a: NewProject["aspect"]) => {
      URL.revokeObjectURL(url);
      resolve(a);
    };
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      const r = v.videoWidth / Math.max(1, v.videoHeight);
      done(r < 0.85 ? "9:16" : r > 1.2 ? "16:9" : "1:1");
    };
    v.onerror = () => done("16:9");
    v.src = url;
  });
}

export function Studio() {
  const params = useSearchParams();
  const reduce = useReducedMotion();
  const search = useRef<HTMLInputElement>(null);
  const { user: clerkUser } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const [creating, setCreating] = useState<NewProject["aspect"] | null>(null);
  const user = clerkUser
    ? {
        name: clerkUser.fullName || clerkUser.username || clerkUser.primaryEmailAddress?.emailAddress.split("@")[0] || "You",
        email: clerkUser.primaryEmailAddress?.emailAddress ?? "",
        firstName: clerkUser.firstName,
      }
    : null;
  // Set after mount: the clock must not be read during prerender.
  const [hello, setHello] = useState("Hello");
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  // ?recipe= (from the landing page's sign-up form) opens New project with that recipe filled in.
  const [draft, setDraft] = useState<Draft | null>(() => {
    const r = RECIPES.find((x) => x.id === params.get("recipe"));
    return r ? { ...EMPTY_DRAFT, name: r.title, aspect: r.aspect, fps: r.fps, brief: r.brief } : null;
  });
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [dropping, setDropping] = useState(false);

  const load = useCallback(() => {
    api
      .listProjects()
      .then((list) => {
        setProjects(list);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't reach the server. Is the API running on port 8000?"));
  }, []);

  useEffect(() => {
    load();
    // The greeting reads the clock, so it is set after mount rather than during prerender.
    const id = requestAnimationFrame(() => setHello(greeting()));
    return () => cancelAnimationFrame(id);
  }, [load]);

  // "/" or Cmd+K focuses search; N opens a new project.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea") || draft) return;
      if (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        setView((v) => (v === "recipes" ? "projects" : v));
        search.current?.focus();
      } else if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setDraft(EMPTY_DRAFT);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (projects ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
    return sort === "name" ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : list;
  }, [projects, query, sort]);

  async function rename(p: ProjectSummary, name: string) {
    setProjects((list) => list?.map((x) => (x.id === p.id ? { ...x, name } : x)) ?? null);
    try {
      await api.renameProject(p.id, name);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      load();
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    setProjects((list) => list?.filter((x) => x.id !== target.id) ?? null);
    try {
      await api.deleteProject(target.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      load();
    }
  }

  async function dropFootage(files: File[]) {
    const media = files.filter((f) => f.type.startsWith("video/") || f.type.startsWith("audio/"));
    const firstVideo = media.find((f) => f.type.startsWith("video/"));
    if (!media.length) return setError("Drop video (MP4, MOV) or audio (MP3, WAV) files.");
    setDraft({ ...EMPTY_DRAFT, files: media, aspect: firstVideo ? await aspectOf(firstVideo) : "16:9" });
  }

  // A format tile makes an empty project straight away and opens it; footage goes in from the editor.
  async function blank(aspect: NewProject["aspect"]) {
    setCreating(aspect);
    try {
      const p = await api.createProject({ name: untitled(), aspect, fps: 30 });
      router.push(`/p/${p.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reach the server. Is the API running on port 8000?");
      setCreating(null);
    }
  }

  const fromRecipe = (r: Recipe) => setDraft({ ...EMPTY_DRAFT, name: r.title, aspect: r.aspect, fps: r.fps, brief: r.brief });

  const firstName = user?.firstName ?? user?.name.split(" ")[0];
  const searching = query.trim().length > 0;

  return (
    <div
      className="paper-texture min-h-[100dvh] bg-paper text-ink lg:grid lg:grid-cols-[264px_minmax(0,1fr)]"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => e.relatedTarget === null && setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        dropFootage(Array.from(e.dataTransfer.files));
      }}
    >
      {/* Sidebar (a top bar on small screens). */}
      <aside className="flex items-center gap-3 border-b-2 border-ink px-4 py-3 lg:sticky lg:top-0 lg:h-[100dvh] lg:flex-col lg:items-stretch lg:gap-0 lg:border-r-2 lg:border-b-0 lg:px-5 lg:py-6">
        <div className="lg:px-1">
          <Logo />
        </div>

        <button
          type="button"
          onClick={() => setDraft(EMPTY_DRAFT)}
          className="hard group ml-auto inline-flex h-11 items-stretch overflow-hidden rounded-full bg-pink text-[14px] font-semibold lg:mt-8 lg:ml-0"
        >
          <span className="grid w-11 place-items-center bg-ink text-paper transition-colors group-hover:bg-tomato">
            <Plus size={17} weight="bold" />
          </span>
          <span className="flex items-center pr-5 pl-3.5 whitespace-nowrap">New project</span>
          <kbd className="mr-3 hidden items-center self-center rounded-[4px] border border-ink/30 px-1.5 font-mono text-[10px] lg:flex">N</kbd>
        </button>

        <nav aria-label="Studio" className="hidden lg:mt-8 lg:block">
          <ul className="space-y-1">
            {NAV.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button
                  type="button"
                  aria-current={view === id ? "page" : undefined}
                  onClick={() => setView(id)}
                  className={`relative flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-[15px] font-medium transition-colors ${
                    view === id ? "text-ink" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
                  }`}
                >
                  {view === id && (
                    <motion.span layoutId="studio-nav" className="absolute inset-0 rounded-full border-2 border-ink bg-lime" transition={{ duration: 0.4, ease: EASE_OUT }} />
                  )}
                  <Icon size={18} weight={view === id ? "fill" : "regular"} className="relative" />
                  <span className="relative">{label}</span>
                  {id === "projects" && projects && <span className="relative ml-auto font-mono text-[11px] text-ink/50">{projects.length}</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden lg:mt-auto lg:block">
          <Link href="/" className="label flex items-center gap-1.5 px-1 text-[10px] text-ink/50 hover:text-ink">
            Back to site <ArrowSquareOut size={12} />
          </Link>
          <div className="mt-4 flex items-center gap-3 rounded-[16px] border-2 border-ink bg-paper p-2.5">
            <span className="display grid size-10 shrink-0 place-items-center rounded-[12px] border-2 border-ink bg-sun text-[20px]">
              {user?.name.charAt(0) ?? "·"}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold">{user?.name ?? "Loading"}</p>
              <p className="truncate text-[12px] text-ink/50">{user?.email ?? " "}</p>
            </div>
            <button
              type="button"
              onClick={() => signOut({ redirectUrl: "/" })}
              aria-label="Sign out"
              title="Sign out"
              className="ml-auto grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-ink hover:text-paper"
            >
              <SignOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 px-[var(--gutter)] pt-6 pb-24 lg:pt-8">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full border-2 border-ink bg-paper px-4 focus-within:shadow-[0_3px_0_0_var(--ink)] sm:max-w-[420px]">
            <MagnifyingGlass size={17} className="shrink-0 text-ink/50" />
            <span className="sr-only">Search projects</span>
            <input
              ref={search}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (view === "recipes") setView("projects");
              }}
              placeholder="Search projects"
              className="min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-ink/40 focus:outline-none"
            />
            <kbd className="rounded-[4px] border border-ink/25 px-1.5 font-mono text-[10px] text-ink/50">/</kbd>
          </label>
          <div className="flex rounded-full border-2 border-ink p-0.5 lg:hidden">
            {NAV.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${view === id ? "bg-ink text-lime" : "text-ink/60"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="label ml-auto hidden text-ink/50 md:block">(02) Studio</p>
        </div>

        {error && (
          <div role="alert" className="mt-6 flex items-start gap-3 rounded-[14px] border-2 border-ink bg-sun px-4 py-3">
            <Warning size={18} weight="fill" className="mt-0.5 shrink-0 text-tomato" />
            <p className="text-[14px]">{error}</p>
            <button type="button" onClick={load} className="ml-auto shrink-0 text-[14px] font-semibold underline underline-offset-4">
              Retry
            </button>
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={searching ? "search" : view}
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: EASE_OUT }}
          >
            {view === "home" && !searching && (
              <>
                <header className="mt-10 lg:mt-14">
                  <h1 className="display text-[clamp(52px,7vw,112px)]">
                    {hello}
                    {firstName ? `, ${firstName}.` : "."}
                  </h1>
                  <p className="pb-1 font-serif text-[clamp(32px,4vw,60px)] leading-[1.05] italic text-tomato">what are we cutting today?</p>
                </header>

                <section aria-labelledby="quick-start" className="mt-12">
                  <SectionHead id="quick-start" kicker="One click, empty timeline" title="Blank project" />
                  <div className="mt-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
                    {ASPECTS.map((a, i) => (
                      <motion.button
                        key={a.value}
                        type="button"
                        onClick={() => blank(a.value)}
                        disabled={creating !== null}
                        aria-busy={creating === a.value}
                        initial={reduce ? false : { opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.05 * i, duration: 0.6, ease: EASE_OUT }}
                        className="group flex flex-col items-start gap-6 rounded-[18px] border-2 border-ink bg-paper p-5 text-left shadow-[0_4px_0_0_var(--ink)] transition-[transform,box-shadow] duration-300 ease-[var(--ease-out)] hover:-translate-y-1 hover:shadow-[0_8px_0_0_var(--ink)]"
                      >
                        <span className="transition-transform duration-500 ease-[var(--ease-back)] group-hover:-rotate-6">
                          <AspectGlyph aspect={a.value} color={a.color} />
                        </span>
                        <span>
                          <span className="display block text-[36px]">{a.value}</span>
                          <span className="mt-1 block text-[14px] text-ink/60">{creating === a.value ? "Opening the editor…" : a.use}</span>
                        </span>
                      </motion.button>
                    ))}
                    <motion.button
                      type="button"
                      onClick={() => setDraft(EMPTY_DRAFT)}
                      initial={reduce ? false : { opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.15, duration: 0.6, ease: EASE_OUT }}
                      className="mat group flex flex-col items-start gap-6 rounded-[18px] border-2 border-ink p-5 text-left text-paper shadow-[0_4px_0_0_var(--tomato)] transition-[transform,box-shadow] duration-300 ease-[var(--ease-out)] hover:-translate-y-1 hover:shadow-[0_8px_0_0_var(--tomato)]"
                    >
                      <span className="grid size-11 place-items-center rounded-full border-2 border-paper bg-pink text-ink transition-transform duration-500 ease-[var(--ease-back)] group-hover:scale-110">
                        <UploadSimple size={18} weight="bold" />
                      </span>
                      <span>
                        <span className="display block text-[36px]">Drop footage</span>
                        <span className="mt-1 block text-[14px] text-paper/60">Anywhere on this page. The format follows your clips.</span>
                      </span>
                    </motion.button>
                  </div>
                </section>

                <section aria-labelledby="recent" className="mt-16">
                  <SectionHead
                    id="recent"
                    kicker="Pick up where you left off"
                    title="Recent projects"
                    action={projects && projects.length > 6 ? { label: "See all", onClick: () => setView("projects") } : undefined}
                  />
                  <ProjectGrid
                    projects={projects === null ? null : shown.slice(0, 6)}
                    onRename={rename}
                    onDelete={setDeleting}
                    onCreate={() => setDraft(EMPTY_DRAFT)}
                  />
                </section>

                <section aria-labelledby="recipes-home" className="mt-16">
                  <SectionHead id="recipes-home" kicker="Hand the agent a brief" title="Start from a recipe" action={{ label: "All recipes", onClick: () => setView("recipes") }} />
                  <RecipeRow recipes={RECIPES.slice(0, 3)} onPick={fromRecipe} />
                </section>
              </>
            )}

            {(view === "projects" || searching) && (
              <section aria-labelledby="all-projects" className="mt-10 lg:mt-14">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <h1 id="all-projects" className="display text-[clamp(52px,7vw,112px)]">
                    {searching ? "Results" : "Projects"}
                  </h1>
                  <div className="flex rounded-full border-2 border-ink p-0.5" role="radiogroup" aria-label="Sort">
                    {(["recent", "name"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={sort === s}
                        onClick={() => setSort(s)}
                        className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium ${sort === s ? "bg-ink text-lime" : "text-ink/60 hover:text-ink"}`}
                      >
                        {s === "recent" ? "Last edited" : "Name"}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="mt-2 text-[15px] text-ink/55">
                  {projects === null ? "Loading" : searching ? `${shown.length} matching “${query.trim()}”` : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`}
                </p>
                <ProjectGrid projects={projects === null ? null : shown} onRename={rename} onDelete={setDeleting} onCreate={() => setDraft(EMPTY_DRAFT)} searching={searching} />
              </section>
            )}

            {view === "recipes" && !searching && (
              <section aria-labelledby="recipes" className="mt-10 lg:mt-14">
                <h1 id="recipes" className="display text-[clamp(52px,7vw,112px)]">
                  Recipes
                </h1>
                <p className="mt-2 max-w-[56ch] text-[16px] leading-relaxed text-ink/60">
                  A recipe sets the format and writes the first brief. Upload your clips and the agent starts from there. You can change every word.
                </p>
                <RecipeRow recipes={RECIPES} onPick={fromRecipe} />
              </section>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <CreateProjectDialog draft={draft} onClose={() => setDraft(null)} />
      <ConfirmDelete project={deleting} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} />

      <AnimatePresence>
        {dropping && !draft && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-3 z-30 grid place-items-center rounded-[28px] border-4 border-dashed border-ink bg-lime/85"
          >
            <p className="display text-[clamp(56px,8vw,128px)] text-forest">Drop to start</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SectionHead(props: { id: string; kicker: string; title: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex items-end justify-between gap-4 border-b-2 border-ink pb-3">
      <div>
        <p className="label text-[10px] text-ink/50">⁞ {props.kicker}</p>
        <h2 id={props.id} className="display mt-2 text-[34px]">
          {props.title}
        </h2>
      </div>
      {props.action && (
        <button type="button" onClick={props.action.onClick} className="mb-1 text-[14px] font-semibold underline decoration-tomato decoration-2 underline-offset-4 hover:decoration-ink">
          {props.action.label}
        </button>
      )}
    </div>
  );
}

function ProjectGrid(props: {
  projects: ProjectSummary[] | null;
  onRename: (p: ProjectSummary, name: string) => Promise<void>;
  onDelete: (p: ProjectSummary) => void;
  onCreate: () => void;
  searching?: boolean;
}) {
  if (props.projects === null) {
    return (
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <ProjectCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (props.projects.length === 0) {
    return (
      <div className="mt-6 grid place-items-center rounded-[18px] border-2 border-dashed border-ink/40 px-6 py-14 text-center">
        <p className="display text-[40px]">{props.searching ? "Nothing by that name." : "Nothing on the reel yet."}</p>
        <p className="mt-2 max-w-[40ch] text-[15px] text-ink/60">
          {props.searching ? "Try another word, or clear the search." : "Start a project, drop your footage in and tell the agent what you want."}
        </p>
        {!props.searching && (
          <button type="button" onClick={props.onCreate} className="hard mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-pink px-5 text-[14px] font-semibold">
            <Plus size={16} weight="bold" /> New project
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {props.projects.map((p, i) => (
        <ProjectCard key={p.id} project={p} index={i} onRename={(name) => props.onRename(p, name)} onDelete={() => props.onDelete(p)} />
      ))}
    </div>
  );
}

function RecipeRow({ recipes, onPick }: { recipes: Recipe[]; onPick: (r: Recipe) => void }) {
  return (
    <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      {recipes.map((r, i) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onPick(r)}
          style={{ backgroundColor: r.color, color: r.ink }}
          className="group relative flex min-h-[220px] flex-col justify-between overflow-hidden rounded-[18px] border-2 border-ink p-5 text-left shadow-[0_4px_0_0_var(--ink)] transition-[transform,box-shadow] duration-300 ease-[var(--ease-out)] hover:-translate-y-1 hover:shadow-[0_8px_0_0_var(--ink)]"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="label text-[10px] opacity-70">R/{String(i + 1).padStart(2, "0")}</span>
            <span className="label rounded-full border-2 border-current px-2 py-0.5 text-[10px]">
              {r.aspect} · {r.fps} fps
            </span>
          </div>
          <div>
            <h3 className="display text-[40px]">{r.title}</h3>
            <p className="mt-2 max-w-[34ch] text-[14px] leading-snug opacity-80">{r.blurb}</p>
            <p className="mt-4 rotate-[-2deg] font-hand text-[19px] leading-tight opacity-90 transition-transform duration-500 ease-[var(--ease-out)] group-hover:translate-x-1">
              “{r.brief.split(",")[0]}...”
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}

function ConfirmDelete({ project, onCancel, onConfirm }: { project: ProjectSummary | null; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    if (!project) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project, onCancel]);
  return (
    <AnimatePresence>
      {project && (
        <motion.div
          className="fixed inset-0 z-40 grid place-items-center bg-ink/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            initial={{ y: 24, scale: 0.96 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE_OUT }}
            className="w-full max-w-[440px] rounded-[22px] border-2 border-ink bg-paper p-7 text-ink shadow-[8px_8px_0_0_var(--tomato)]"
          >
            <h2 id="delete-title" className="display text-[44px]">
              Delete this cut?
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink/70">
              <strong className="font-semibold text-ink">{project.name}</strong>, its footage, renders and edit history will be gone. This can&apos;t be undone.
            </p>
            <div className="mt-7 flex justify-end gap-3">
              <button type="button" onClick={onCancel} autoFocus className="h-11 rounded-full border-2 border-ink px-5 text-[14px] font-semibold hover:bg-ink/5">
                Keep it
              </button>
              <button type="button" onClick={onConfirm} className="hard h-11 rounded-full bg-tomato px-5 text-[14px] font-semibold">
                Delete project
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
