import { getToken } from "@clerk/nextjs";
import type { Media, Schema, Timeline } from "./timeline";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type MediaView = Media & {
  preview_url: string;
  thumb_url: string;
  filmstrip_url: string | null;
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

export type ChatMessage = { role: "user" | "assistant"; text: string; run_id: string; at: string };

export type ProjectView = {
  id: string;
  name: string;
  media: MediaView[];
  timeline: Timeline;
  history: CommitView[];
  chat: ChatMessage[];
  tracks: TrackView[];
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
  applyOps: (id: string, label: string, ops: OpInput[]) => request<ProjectView>(`/projects/${id}/ops`, json({ label, ops })),
  undo: (id: string) => request<ProjectView>(`/projects/${id}/undo`, { method: "POST" }),
  redo: (id: string) => request<ProjectView>(`/projects/${id}/redo`, { method: "POST" }),
  startRun: (id: string, instruction: string) => request<{ run_id: string }>(`/projects/${id}/runs`, json({ instruction })),
  stopRun: (id: string) => request<{ stopped: boolean }>(`/projects/${id}/runs/stop`, { method: "POST" }),
  undoRun: (id: string, runId: string) => request<ProjectView>(`/projects/${id}/runs/${runId}/undo`, { method: "POST" }),
  grade: (id: string, body: { clip_ids: string[] | null; look: string | null; intensity: number; auto: boolean; match: boolean }) =>
    request<ProjectView>(`/projects/${id}/grade`, json(body)),
  render: (id: string, final: boolean) => request<ProjectView>(`/projects/${id}/render`, json({ final })),
};
