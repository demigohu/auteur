import { getToken } from "@clerk/nextjs";
import type { Backdrop, Media, Schema, Storyboard, Timeline } from "./timeline";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type MediaView = Media & {
  preview_url: string;
  thumb_url: string;
  filmstrip_url: string | null;
  /** Picture of the sound (~40 px per second), for clips with audio and music. */
  waveform_url: string | null;
  beats: number[] | null;
};

export type CommitView = {
  id: string;
  author: "agent" | "user";
  label: string;
  run_id: string | null;
  at: string;
};

export type TrackView = { id: string; media_id: string; prompt: string; url: string };

export type ChatMessage = { role: "user" | "assistant"; text: string; run_id: string; at: string; images?: string[] };

/** A still the user wants the grade to look like. */
export type ReferenceView = { id: string; name: string; url: string };

/** The latest checker verdict. `head` is the newest commit id when it ran; past that, marks may be stale. */
export type CheckResult = {
  passed: boolean;
  issues: string[];
  marks: { start: number; end: number; label: string }[];
  render: string;
  run_id: string;
  head: string | null;
  at: string;
};

/** A background export from the Export dialog (api/src/auteur/exporter.py). */
export type ExportFormat = "mp4" | "gif" | "mp3";
export type ExportQuality = "draft" | "standard" | "high";
export type ExportView = {
  id: string;
  format: ExportFormat;
  resolution: number;
  quality: ExportQuality;
  fps: number;
  mbps: number | null;
  status: "running" | "done" | "failed" | "cancelled";
  progress: number;
  url: string | null;
  error: string | null;
};
export type ExportRequest = { format: ExportFormat; resolution: number; quality: ExportQuality; fps: number | null; mbps?: number | null };

/** The timeline's spoken words (api transcript_edit.TranscriptView). */
export type TranscriptView = {
  clips: {
    clip_id: string;
    media_id: string;
    start: number;
    words: { text: string; src_start: number; src_end: number; start: number; end: number; filler: boolean }[];
  }[];
  missing: string[];
  missing_seconds: number;
};

export type ProjectView = {
  id: string;
  name: string;
  media: MediaView[];
  timeline: Timeline;
  history: CommitView[];
  chat: ChatMessage[];
  tracks: TrackView[];
  references: ReferenceView[];
  last_check: CheckResult | null;
  storyboard: Storyboard | null;
  export: ExportView | null;
  luts: { id: string; name: string; size: number }[];
  /** Clips played from a prepared variant (reversed or with a LUT): its url, or null while it is made. */
  clip_previews: Record<string, string | null>;
  /** Largest export the server makes (short side), or null for no limit. */
  max_export_height: number | null;
  speech: [number, number][];
  spent: number;
  last_render_url: string | null;
  can_undo: boolean;
  can_redo: boolean;
  busy: boolean;
};

export type ProjectSummary = {
  id: string;
  name: string;
  updated_at: string;
  thumb_url: string | null;
  duration: number;
  aspect: Timeline["aspect"];
  fps: number;
  clips: number;
  media: number;
};


/** The storyboard panel's edits; scenes without an id are new. */
export type StoryboardEdit = {
  style: string;
  scenes: { id: string; title: string; duration: number; brief: string; images: string[] }[];
};

export type NewProject = { name: string; aspect: Timeline["aspect"]; fps: 24 | 30 | 60 };

export type Op = Schema["op"];

/** An op as sent by the editor: fields with server-side defaults may be left out. */
export type OpInput = Op extends infer O ? (O extends { op: infer K } ? Partial<O> & { op: K } : never) : never;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Clerk's session token goes along as a bearer token; getToken waits for Clerk to load and refreshes
  // the short-lived token as needed. Credentials too, for the __session cookie the event stream uses.
  const token = typeof window === "undefined" ? null : await getToken().catch(() => null);
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include" });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const fileUrl = (path: string) => `${API_URL}${path}`;

export const api = {
  listProjects: () => request<ProjectSummary[]>("/projects"),
  createProject: (body: NewProject) => request<ProjectView>("/projects", json(body)),
  renameProject: (id: string, name: string) => request<ProjectView>(`/projects/${id}`, json({ name }, "PATCH")),
  deleteProject: (id: string) => request<{ status: string }>(`/projects/${id}`, { method: "DELETE" }),
  getProject: (id: string) => request<ProjectView>(`/projects/${id}`),
  upload: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ProjectView>(`/projects/${id}/media`, { method: "POST", body: form });
  },
  /** Upload with progress (0..1), for the phone upload page where files are big and the network slow. */
  uploadWithProgress: async (id: string, file: File, onProgress: (p: number) => void): Promise<ProjectView> => {
    const token = await getToken().catch(() => null);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_URL}/projects/${id}/media`);
      xhr.withCredentials = true;
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let body: { detail?: unknown } | undefined;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as ProjectView);
        else reject(new ApiError(xhr.status, typeof body?.detail === "string" ? body.detail : xhr.statusText || "Upload failed"));
      };
      xhr.onerror = () => reject(new ApiError(0, "The upload didn't reach the server"));
      const form = new FormData();
      form.append("file", file);
      xhr.send(form);
    });
  },
  uploadLut: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ProjectView>(`/projects/${id}/luts`, { method: "POST", body: form });
  },
  deleteLut: (id: string, lutId: string) => request<ProjectView>(`/projects/${id}/luts/${lutId}`, { method: "DELETE" }),
  freezeFrame: (id: string, clipId: string, at: number, duration: number) =>
    request<ProjectView>(`/projects/${id}/clips/${clipId}/freeze`, json({ at, duration })),
  removeBackground: (id: string, clipId: string, body: { prompt: string; keep: "main" | "all"; backdrop: Backdrop }) =>
    request<ProjectView>(`/projects/${id}/clips/${clipId}/remove-background`, json(body)),
  getTranscript: (id: string) => request<TranscriptView>(`/projects/${id}/transcript`),
  runTranscription: (id: string) => request<TranscriptView>(`/projects/${id}/transcript/run`, { method: "POST" }),
  cutWords: (id: string, cuts: { clip_id: string; src_start: number; src_end: number }[], label: string) =>
    request<ProjectView>(`/projects/${id}/transcript/cut`, json({ cuts, label })),
  generateImage: (id: string, prompt: string) => request<ProjectView>(`/projects/${id}/media/generate`, json({ prompt })),
  translateTexts: (id: string, language: string, subtitlesOnly: boolean) =>
    request<ProjectView>(`/projects/${id}/texts/translate`, json({ language, subtitles_only: subtitlesOnly })),
  voiceover: (id: string, body: { text: string; language: string; voice: string; speed: number; at: number | null }) =>
    request<ProjectView>(`/projects/${id}/voiceover`, json(body)),
  dub: (id: string, language: string, voice: string) => request<ProjectView>(`/projects/${id}/dub`, json({ language, voice })),
  importLink: (id: string, url: string) => request<ProjectView>(`/projects/${id}/media/link`, json({ url })),
  applyOps: (id: string, label: string, ops: OpInput[]) => request<ProjectView>(`/projects/${id}/ops`, json({ label, ops })),
  undo: (id: string) => request<ProjectView>(`/projects/${id}/undo`, { method: "POST" }),
  redo: (id: string) => request<ProjectView>(`/projects/${id}/redo`, { method: "POST" }),
  startRun: (id: string, instruction: string, referenceIds: string[] = []) =>
    request<{ run_id: string }>(`/projects/${id}/runs`, json({ instruction, reference_ids: referenceIds })),
  uploadReference: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ProjectView>(`/projects/${id}/references`, { method: "POST", body: form });
  },
  deleteReference: (id: string, refId: string) => request<ProjectView>(`/projects/${id}/references/${refId}`, { method: "DELETE" }),
  stopRun: (id: string) => request<{ stopped: boolean }>(`/projects/${id}/runs/stop`, { method: "POST" }),
  undoRun: (id: string, runId: string) => request<ProjectView>(`/projects/${id}/runs/${runId}/undo`, { method: "POST" }),
  grade: (
    id: string,
    body: { clip_ids: string[] | null; look: string | null; intensity: number; auto: boolean; match: boolean; reference_id?: string | null },
  ) =>
    request<ProjectView>(`/projects/${id}/grade`, json(body)),
  editStoryboard: (id: string, body: StoryboardEdit) => request<ProjectView>(`/projects/${id}/storyboard`, json(body, "PUT")),
  buildScenes: (id: string, sceneIds: string[] | null, notes: { scene_id: string; note: string }[] = []) =>
    request<{ run_id: string }>(`/projects/${id}/scenes/build`, json({ scene_ids: sceneIds, notes })),
  startExport: (id: string, body: ExportRequest) => request<ExportView>(`/projects/${id}/exports`, json(body)),
  cancelExport: (id: string, exportId: string) =>
    request<{ cancelled: boolean }>(`/projects/${id}/exports/${exportId}/cancel`, { method: "POST" }),
};
