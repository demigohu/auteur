"use client";

import { create } from "zustand";
import { api, API_URL, fileUrl, type OpInput, type ProjectView } from "./api";
import { clipDuration, clipStarts } from "./time";
import type { Clip, Grade } from "./timeline";
import type { TrackData } from "./tracks";

export type StepStatus = "pending" | "running" | "done" | "failed";

export type LogItem =
  | { kind: "thought"; text: string }
  | { kind: "tool"; id: number; tool: string; args: Record<string, unknown>; step: number | null; ok?: boolean; output?: string }
  | { kind: "check"; passed: boolean; issues: string[]; render: string };

/** A time range the checker flagged, drawn on the timeline ruler. */
export type CheckMark = { start: number; end: number; label: string };

export type RunState = {
  id: string;
  instruction: string;
  plan: { text: string; status: StepStatus }[];
  log: LogItem[];
  progress: number | null;
  cost: number;
  status: "running" | "done" | "failed" | "stopped" | "cancelled" | "error";
};

type AgentEvent = { type: string; run_id: string; [key: string]: unknown };

export type SideTab = "agent" | "inspector" | "history";

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
  marks: CheckMark[];
  /** While true the preview shows the untouched footage (held "Before" button). */
  before: boolean;

  load: (id: string) => Promise<void>;
  connect: (id: string) => () => void;
  applyOps: (label: string, ops: OpInput[]) => Promise<boolean>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  upload: (files: File[]) => Promise<void>;
  startRun: (instruction: string) => Promise<void>;
  stopRun: () => Promise<void>;
  undoRun: (runId: string) => Promise<void>;
  exportVideo: () => Promise<void>;
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
  applyLook: (o: { clipIds: string[] | null; look: string | null; intensity: number; auto: boolean; match: boolean }) => Promise<void>;
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
    const run = get().run;
    if (e.type === "run_started") {
      set({
        run: { id: e.run_id, instruction: String(e.instruction), plan: [], log: [], progress: null, cost: 0, status: "running" },
        tab: "agent",
        marks: [],
      });
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
        set({ marks: (e.marks as CheckMark[]) ?? [] });
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
    marks: [],
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
      const types = ["run_started", "plan", "thought", "tool_call", "tool_result", "progress", "check", "timeline", "track", "cost", "message", "run_finished"];
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
    startRun: async (instruction) => {
      const id = get().project?.id;
      if (!id) return;
      set({ error: null });
      try {
        await api.startRun(id, instruction);
        // The run_started event arrives over SSE; mark busy right away so the timeline locks.
        const project = get().project;
        if (project) set({ project: { ...project, busy: true } });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    },
    stopRun: async () => {
      const id = get().project?.id;
      if (id) await api.stopRun(id).catch(() => undefined);
    },
    undoRun: async (runId) => {
      const id = get().project?.id;
      if (id) await act("Undoing instruction", () => api.undoRun(id, runId));
    },
    exportVideo: async () => {
      const id = get().project?.id;
      if (id) await act("Exporting video", () => api.render(id, true));
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
    applyLook: async ({ clipIds, look, intensity, auto, match }) => {
      const id = get().project?.id;
      if (id) await act("Applying color", () => api.grade(id, { clip_ids: clipIds, look, intensity, auto, match }));
    },
    previewGrade: (clipId, grade) => {
      const project = get().project;
      if (!project) return;
      const clips = project.timeline.clips.map((c) => (c.id === clipId ? { ...c, grade } : c));
      set({ project: { ...project, timeline: { ...project.timeline, clips } } });
    },
    setTime: (t) => set({ time: t }),
    seek: (t) => set({ time: t, seekRequest: { time: t, nonce: Date.now() } }),
    setZoom: (px) => set({ pxPerSecond: Math.min(240, Math.max(12, px)) }),
    clearError: () => set({ error: null }),
  };
});
