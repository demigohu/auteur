import type { MediaView } from "./api";

/** What the media bin and the new-project dialog accept (pictures become clips, see api/src/auteur/media.py). */
export const UPLOAD_ACCEPT = "video/mp4,video/quicktime,video/webm,audio/*,image/png,image/jpeg,image/webp,image/gif";

export const isUploadable = (f: File) => /^(video|audio)\//.test(f.type) || /^image\/(png|jpeg|webp|gif)$/.test(f.type);

/** Length of a new clip of this media: a still picture starts at 5 seconds, everything else whole. */
export const clipLength = (m: Pick<MediaView, "image" | "duration">) => Number((m.image === "still" ? 5 : m.duration).toFixed(3));

export type MediaGroup = "footage" | "pictures" | "scenes" | "audio";

export const groupOf = (m: Pick<MediaView, "kind" | "image" | "scene_id">): MediaGroup =>
  m.kind === "audio" ? "audio" : m.scene_id ? "scenes" : m.image ? "pictures" : "footage";
