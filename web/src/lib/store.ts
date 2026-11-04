"use client";

import { create } from "zustand";
import { api, API_URL, type ExportRequest, type ExportView, fileUrl, type OpInput, type ProjectView, type StoryboardEdit } from "./api";
import { clipDuration, clipStarts } from "./time";
import type { Backdrop, Clip, Grade, Overlay, Transform } from "./timeline";
import type { TrackData } from "./tracks";

export type StepStatus = "pending" | "running" | "done" | "failed";

export type LogItem =
  | { kind: "thought"; text: string }
  | { kind: "tool"; id: number; tool: string; args: Record<string, unknown>; step: number | null; ok?: boolean; output?: string }
  | { kind: "check"; passed: boolean; issues: string[]; render: string };

/** A time range the checker flagged, drawn on the timeline ruler. */
export type CheckMark = { start: number; end: number; label: string };

/** True once the timeline has moved past the commit the checker saw (an edit, undo or redo), so its
 * marks may point at the wrong place. */
/** Timeline zoom in pixels per second: 1 fits half an hour in a wide window; 240 shows single frames. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 240;

export function isCheckStale(project: Pick<ProjectView, "history" | "last_check">): boolean {
  const check = project.last_check;
  return check !== null && (project.history.at(-1)?.id ?? null) !== check.head;
}

export type RunState = {
  id: string;
  instruction: string;
  images: string[];
  plan: { text: string; status: StepStatus }[];
  log: LogItem[];
  progress: number | null;
  cost: number;
  status: "running" | "done" | "failed" | "stopped" | "cancelled" | "error";
};

type AgentEvent = { type: string; run_id: string; [key: string]: unknown };

export type SideTab = "agent" | "story" | "words" | "inspector" | "history";

type EditorState = {
  project: ProjectView | null;
  error: string | null;
  pending: string | null;
  run: RunState | null;
  selectedClipId: string | null;
  selectedTextId: string | null;
  selectedOverlayId: string | null;
  selectedAudioId: string | null;
  /** Extra clips picked with shift-click, on top of selectedClipId. */
  multiClipIds: string[];
  clipboard: Clip[];
  time: number;
  seekRequest: { time: number; nonce: number } | null;
  pxPerSecond: number;
  tab: SideTab;
  tracks: Record<string, TrackData>;
  showTracks: boolean;
  /** While true the preview shows the untouched footage (held "Before" button). */
  before: boolean;

  load: (id: string) => Promise<void>;
  connect: (id: string) => () => void;
  applyOps: (label: string, ops: OpInput[]) => Promise<boolean>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  upload: (files: File[]) => Promise<void>;
  importLink: (url: string) => Promise<boolean>;
  voiceover: (body: { text: string; language: string; voice: string; speed: number; atPlayhead: boolean }) => Promise<boolean>;
  dub: (language: string, voice: string) => Promise<boolean>;
  translateTexts: (language: string, subtitlesOnly: boolean) => Promise<boolean>;
  generateImage: (prompt: string) => Promise<boolean>;
  cutWords: (cuts: { clip_id: string; src_start: number; src_end: number }[], label: string) => Promise<boolean>;
  /** Hold the frame under the playhead for `duration` seconds. */
  freezeFrame: (duration?: number) => Promise<boolean>;
  /** Cut the subject out with SAM 3.1 and put a backdrop behind it. */
  removeBackground: (clipId: string, body: { prompt: string; keep: "main" | "all"; backdrop: Backdrop }) => Promise<boolean>;
  uploadLut: (file: File) => Promise<boolean>;
  deleteLut: (lutId: string) => Promise<boolean>;
  startRun: (instruction: string, referenceIds?: string[]) => Promise<void>;
  uploadReference: (file: File) => Promise<string | null>;
  editStoryboard: (body: StoryboardEdit) => Promise<boolean>;
  /** Build storyboard scenes with Muse Wonder (null = every scene that isn't ready). */
  buildScenes: (sceneIds: string[] | null, notes?: { scene_id: string; note: string }[]) => Promise<void>;
  deleteReference: (refId: string) => Promise<void>;
  stopRun: () => Promise<void>;
  undoRun: (runId: string) => Promise<void>;
  /** Start a background export; its progress arrives as "export" events on project.export. */
  startExport: (body: ExportRequest) => Promise<boolean>;
  cancelExport: () => Promise<void>;
  select: (sel: { clip?: string | null; text?: string | null; overlay?: string | null; audio?: string | null }) => void;
  setTab: (tab: SideTab) => void;
  toggleMulti: (clipId: string) => void;
  copyClips: () => void;
  pasteClips: () => void;
  deleteSelection: () => void;
  setShowTracks: (on: boolean) => void;
  setBefore: (on: boolean) => void;
  /** Local-only grade change for live slider feedback; the commit goes through applyOps. */
  previewGrade: (clipId: string, grade: Grade) => void;
  /** Local-only transform while dragging on the canvas; the commit goes through applyOps. */
  previewTransform: (clipId: string, transform: Transform | null) => void;
  /** Local-only keyframes while dragging a keyframed clip on the canvas. */
  previewTransformKeys: (clipId: string, keys: Clip["transform_keys"]) => void;
  /** Local-only text position while dragging it on the canvas. */
  previewTextPosition: (textId: string, x: number, y: number) => void;
  /** Local-only B-roll box while dragging it on the canvas. */
  previewOverlayBox: (overlayId: string, box: NonNullable<Overlay["box"]>) => void;
  applyLook: (o: {
    clipIds: string[] | null;
    look: string | null;
    intensity: number;
    auto: boolean;
    match: boolean;
    referenceId?: string | null;
  }) => Promise<void>;
  setTime: (t: number) => void;
  seek: (t: number) => void;
  setZoom: (px: number) => void;
  clearError: () => void;
};

export const useEditor = create<EditorState>((set, get) => {
  /** Swap in a new project and fetch any track data the preview doesn't have yet. */
  function setProject(project: ProjectView) {
    set({ project });
    for (const t of project.tracks) {
      if (get().tracks[t.id]) continue;
      fetch(fileUrl(t.url))
        .then((r) => r.json())
        .then((data: TrackData) => set((s) => ({ tracks: { ...s.tracks, [t.id]: data } })))
        .catch(() => undefined);
    }
  }

  /** Wraps an API call: shows the pending label, stores errors, swaps in the returned project. */
  async function act(label: string, fn: () => Promise<ProjectView>): Promise<boolean> {
    set({ pending: label, error: null });
    try {
      setProject(await fn());
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      set({ pending: null });
    }
  }

  function onEvent(e: AgentEvent) {
    if (e.type === "project") {
      // Changes from outside this editor (an upload from the phone), between runs.
      setProject(e.project as ProjectView);
      return;
    }
    if (e.type === "export") {
      // Exports run beside agent runs, so this comes before the run checks.
      const project = get().project;
      const job = e.export as ExportView;
      if (project) set({ project: { ...project, export: job, last_render_url: job.status === "done" && job.format === "mp4" ? job.url : project.last_render_url } });
      return;
    }
    const run = get().run;
    if (e.type === "run_started") {
      set({
        run: { id: e.run_id, instruction: String(e.instruction), images: (e.images as string[] | undefined) ?? [], plan: [], log: [], progress: null, cost: 0, status: "running" },
        // Scene builds started from the storyboard stay there, where each scene shows its progress.
        tab: get().tab === "story" ? "story" : "agent",
      });
      const project = get().project;
      if (project) set({ project: { ...project, last_check: null } });
      return;
    }
    if (!run || run.id !== e.run_id) return;
    const update = (patch: Partial<RunState>) => set({ run: { ...run, ...patch } });

    switch (e.type) {
      case "plan":
        update({ plan: (e.steps as string[]).map((text) => ({ text, status: "pending" })) });
        break;
      case "thought":
        update({ log: [...run.log, { kind: "thought", text: String(e.text) }] });
        break;
      case "tool_call": {
        const step = (e.step as number | null) ?? null;
        const plan = run.plan.map((p, i) => {
          if (i === step) return { ...p, status: "running" as const };
          // Moving on to a later step means the earlier ones are finished.
          if (step !== null && i < step && p.status === "running") return { ...p, status: "done" as const };
          return p;
        });
        update({
          plan,
          progress: null,
          log: [...run.log, { kind: "tool", id: run.log.length, tool: String(e.tool), args: e.args as Record<string, unknown>, step }],
        });
        break;
      }
      case "tool_result": {
        const log = [...run.log];
        for (let i = log.length - 1; i >= 0; i--) {
          const item = log[i];
          if (item.kind === "tool" && item.tool === e.tool && item.ok === undefined) {
            log[i] = { ...item, ok: Boolean(e.ok), output: String(e.output) };
            break;
          }
        }
        update({ log, progress: null });
        break;
      }
      case "progress":
        update({ progress: Number(e.value) });
        break;
      case "check":
        update({
          log: [...run.log, { kind: "check", passed: Boolean(e.passed), issues: e.issues as string[], render: String(e.render) }],
        });
        {
          const project = get().project;
          if (project) {
            const last_check = {
              passed: Boolean(e.passed), issues: e.issues as string[], marks: (e.marks as CheckMark[]) ?? [], render: String(e.render),
              run_id: run.id, head: project.history.at(-1)?.id ?? null, at: new Date().toISOString(),
            };
            set({ project: { ...project, last_check } });
          }
        }
        break;
      case "timeline":
        setProject(e.project as ProjectView);
        break;
      case "track":
        // Show the fresh SAM boxes on the preview, the visible proof that the agent "sees" the subject.
        setProject(e.project as ProjectView);
        set({ showTracks: true });
        break;
      case "cost": {
        update({ cost: Number(e.run) });
        const project = get().project;
        if (project) set({ project: { ...project, spent: Number(e.total) } });
        break;
      }
      case "message":
        break;
      case "run_finished": {
        const status = e.status as RunState["status"];
        const ok = status === "done";
        update({
          status,
          progress: null,
          plan: run.plan.map((p) =>
            p.status === "running" || (ok && p.status === "pending") ? { ...p, status: ok ? "done" : "failed" } : p,
          ),
        });
        setProject(e.project as ProjectView);
        break;
      }
    }
  }

  return {
    project: null,
    error: null,
    pending: null,
    run: null,
    selectedClipId: null,
    selectedTextId: null,
    selectedOverlayId: null,
    selectedAudioId: null,
    multiClipIds: [],
    clipboard: [],
    time: 0,
    seekRequest: null,
    pxPerSecond: 48,
    tab: "agent",
    tracks: {},
    showTracks: false,
    before: false,

    load: async (id) => {
      try {
        setProject(await api.getProject(id));
        set({ error: null });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    },

    connect: (id) => {
      const source = new EventSource(`${API_URL}/projects/${id}/events`, { withCredentials: true });
      const types = ["run_started", "plan", "thought", "tool_call", "tool_result", "progress", "check", "timeline", "track", "cost", "message", "run_finished", "export", "project"];
      const handler = (msg: MessageEvent) => onEvent(JSON.parse(msg.data));
      types.forEach((t) => source.addEventListener(t, handler));
      return () => source.close();
    },

    applyOps: (label, ops) => {
      const id = get().project?.id;
      return id ? act(label, () => api.applyOps(id, label, ops)) : Promise.resolve(false);
    },
    undo: async () => {
      const id = get().project?.id;
      if (id) await act("Undo", () => api.undo(id));
    },
    redo: async () => {
      const id = get().project?.id;
      if (id) await act("Redo", () => api.redo(id));
    },
    upload: async (files) => {
      const id = get().project?.id;
      if (!id) return;
      for (const f of files) {
        if (!(await act(`Uploading ${f.name}`, () => api.upload(id, f)))) break;
      }
    },
    uploadLut: (file) => {
      const id = get().project?.id;
      return id ? act(`Adding LUT ${file.name}`, () => api.uploadLut(id, file)) : Promise.resolve(false);
    },
    deleteLut: (lutId) => {
      const id = get().project?.id;
      return id ? act("Removing LUT", () => api.deleteLut(id, lutId)) : Promise.resolve(false);
    },
    freezeFrame: (duration = 2) => {
      const { project, time } = get();
      if (!project) return Promise.resolve(false);
      const clips = project.timeline.clips;
      const starts = clipStarts(clips);
      const i = clips.findIndex((c, k) => time >= starts[k] && time < starts[k] + clipDuration(c));
      if (i < 0) return Promise.resolve(false);
      return act("Freezing the frame", () => api.freezeFrame(project.id, clips[i].id, Number(time.toFixed(3)), duration));
    },
    removeBackground: (clipId, body) => {
      const id = get().project?.id;
      return id ? act("Removing the background", () => api.removeBackground(id, clipId, body)) : Promise.resolve(false);
    },
    cutWords: (cuts, label) => {
      const id = get().project?.id;
      return id ? act(label, () => api.cutWords(id, cuts, label)) : Promise.resolve(false);
    },
    generateImage: (prompt) => {
      const id = get().project?.id;
      return id ? act("Generating with Muse Image", () => api.generateImage(id, prompt)) : Promise.resolve(false);
    },
    translateTexts: (language, subtitlesOnly) => {
      const id = get().project?.id;
      return id ? act(`Translating to ${language}`, () => api.translateTexts(id, language, subtitlesOnly)) : Promise.resolve(false);
    },
    voiceover: ({ atPlayhead, ...body }) => {
      const { project, time } = get();
      if (!project) return Promise.resolve(false);
      return act("Speaking with MMS-TTS", () => api.voiceover(project.id, { ...body, at: atPlayhead ? Number(time.toFixed(3)) : null }));
    },
    dub: (language, voice) => {
      const id = get().project?.id;
      return id ? act(`Dubbing into ${language}`, () => api.dub(id, language, voice)) : Promise.resolve(false);
    },
    importLink: (url) => {
      const id = get().project?.id;
      return id ? act("Importing from link", () => api.importLink(id, url)) : Promise.resolve(false);
    },
    startRun: async (instruction, referenceIds = []) => {
      const id = get().project?.id;
      if (!id) return;
      set({ error: null });
      try {
        await api.startRun(id, instruction, referenceIds);
        // The run_started event arrives over SSE; mark busy right away so the timeline locks.
        const project = get().project;
        if (project) set({ project: { ...project, busy: true } });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    },
    // Returns the new reference's id, so the caller can attach it to the next instruction.
    uploadReference: async (file) => {
      const project = get().project;
      if (!project) return null;
      const before = new Set(project.references.map((r) => r.id));
      const ok = await act(`Attaching ${file.name}`, () => api.uploadReference(project.id, file));
      if (!ok) return null;
      return get().project?.references.find((r) => !before.has(r.id))?.id ?? null;
    },
    editStoryboard: (body) => {
      const id = get().project?.id;
      return id ? act("Saving storyboard", () => api.editStoryboard(id, body)) : Promise.resolve(false);
    },
    buildScenes: async (sceneIds, notes = []) => {
      const id = get().project?.id;
      if (!id) return;
      set({ error: null });
      try {
        await api.buildScenes(id, sceneIds, notes);
        const project = get().project;
        if (project) set({ project: { ...project, busy: true } });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    },
    deleteReference: async (refId) => {
      const id = get().project?.id;
      if (id) await act("Removing reference", () => api.deleteReference(id, refId));
    },
    stopRun: async () => {
      const id = get().project?.id;
      if (id) await api.stopRun(id).catch(() => undefined);
    },
    undoRun: async (runId) => {
      const id = get().project?.id;
      if (id) await act("Undoing instruction", () => api.undoRun(id, runId));
    },
    startExport: async (body) => {
      const project = get().project;
      if (!project) return false;
      set({ error: null });
      try {
        const job = await api.startExport(project.id, body);
        const now = get().project;
        if (now) set({ project: { ...now, export: job } });
        return true;
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },
    cancelExport: async () => {
      const project = get().project;
      if (project?.export?.status === "running") await api.cancelExport(project.id, project.export.id).catch(() => undefined);
    },

    select: ({ clip, text, overlay, audio }) =>
      set((s) => ({
        multiClipIds: [],
        selectedClipId: clip ?? null,
        selectedTextId: text ?? null,
        selectedOverlayId: overlay ?? null,
        selectedAudioId: audio ?? null,
        // Selecting something opens its properties.
        tab: clip || text || overlay || audio ? "inspector" : s.tab,
      })),
    setTab: (tab) => set({ tab }),
    toggleMulti: (clipId) =>
      set((s) => {
        if (!s.selectedClipId) return { selectedClipId: clipId, tab: "inspector" };
        if (clipId === s.selectedClipId) return {};
        const has = s.multiClipIds.includes(clipId);
        return { multiClipIds: has ? s.multiClipIds.filter((x) => x !== clipId) : [...s.multiClipIds, clipId] };
      }),
    copyClips: () => {
      const s = get();
      const ids = new Set([s.selectedClipId, ...s.multiClipIds].filter(Boolean));
      set({ clipboard: (s.project?.timeline.clips ?? []).filter((c) => ids.has(c.id)) });
    },
    pasteClips: () => {
      const s = get();
      if (!s.project || !s.clipboard.length) return;
      // Paste after the clip under the playhead (or at the end).
      const clips = s.project.timeline.clips;
      const starts = clipStarts(clips);
      const i = clips.findIndex((c, k) => s.time >= starts[k] && s.time < starts[k] + clipDuration(c));
      const index = i < 0 ? clips.length : i + 1;
      const [first, ...rest] = s.clipboard;
      s.applyOps(`Paste ${s.clipboard.length} clips`, [{ op: "paste_clips", index, clips: [first, ...rest] }]);
    },
    deleteSelection: () => {
      const s = get();
      const clipIds = [s.selectedClipId, ...s.multiClipIds].filter((x): x is string => Boolean(x));
      const ops: OpInput[] = clipIds.map((id) => ({ op: "delete" as const, clip_id: id }));
      if (s.selectedTextId) ops.push({ op: "delete_text", text_id: s.selectedTextId });
      if (s.selectedOverlayId) ops.push({ op: "delete_overlay", overlay_id: s.selectedOverlayId });
      if (s.selectedAudioId) ops.push({ op: "delete_audio", audio_id: s.selectedAudioId });
      if (ops.length) s.applyOps(clipIds.length > 1 ? `Delete ${clipIds.length} clips` : "Delete", ops);
      s.select({});
    },
    setShowTracks: (on) => set({ showTracks: on }),
    setBefore: (on) => set({ before: on }),
    applyLook: async ({ clipIds, look, intensity, auto, match, referenceId = null }) => {
      const id = get().project?.id;
      if (id)
        await act(referenceId ? "Matching the reference" : "Applying color", () =>
          api.grade(id, { clip_ids: clipIds, look, intensity, auto, match, reference_id: referenceId }),
        );
    },
    previewOverlayBox: (overlayId, box) => {
      const project = get().project;
      if (!project) return;
      const overlays = project.timeline.overlays.map((o) => (o.id === overlayId ? { ...o, box } : o));
      set({ project: { ...project, timeline: { ...project.timeline, overlays } } });
    },
    previewTextPosition: (textId, x, y) => {
      const project = get().project;
      if (!project) return;
      const texts = project.timeline.texts.map((t) => (t.id === textId ? { ...t, x, y } : t));
      set({ project: { ...project, timeline: { ...project.timeline, texts } } });
    },
    previewTransformKeys: (clipId, keys) => {
      const project = get().project;
      if (!project) return;
      const clips = project.timeline.clips.map((c) => (c.id === clipId ? { ...c, transform_keys: keys } : c));
      set({ project: { ...project, timeline: { ...project.timeline, clips } } });
    },
    previewTransform: (clipId, transform) => {
      const project = get().project;
      if (!project) return;
      const clips = project.timeline.clips.map((c) => (c.id === clipId ? { ...c, transform } : c));
      set({ project: { ...project, timeline: { ...project.timeline, clips } } });
    },
    previewGrade: (clipId, grade) => {
      const project = get().project;
      if (!project) return;
      const clips = project.timeline.clips.map((c) => (c.id === clipId ? { ...c, grade } : c));
      set({ project: { ...project, timeline: { ...project.timeline, clips } } });
    },
    setTime: (t) => set({ time: t }),
    seek: (t) => set({ time: t, seekRequest: { time: t, nonce: Date.now() } }),
    setZoom: (px) => set({ pxPerSecond: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, px)) }),
    clearError: () => set({ error: null }),
  };
});
