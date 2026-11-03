import type { Clip } from "./timeline";

/** 00:12:07 style timecode (minutes:seconds:frames) for the editor's readouts. */
export function timecode(seconds: number, fps: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s - Math.floor(s)) * fps);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

export const toFrames = (seconds: number, fps: number) => Math.max(1, Math.round(seconds * fps));

/** Length on the timeline: source length divided by speed (Clip.duration in the API). */
export const clipDuration = (c: Pick<Clip, "src_in" | "src_out" | "speed">) => (c.src_out - c.src_in) / (c.speed ?? 1);

const overlap = (c: Pick<Clip, "transition">, i: number) =>
  i > 0 && c.transition?.kind === "crossfade" ? c.transition.duration : 0;

/** Timeline start of each clip; a crossfade pulls a clip back over the previous one (Timeline.clip_starts). */
export function clipStarts(clips: Pick<Clip, "src_in" | "src_out" | "speed" | "transition">[]): number[] {
  let t = 0;
  return clips.map((c, i) => {
    t -= overlap(c, i);
    const start = t;
    t += clipDuration(c);
    return start;
  });
}

export function timelineDuration(clips: Pick<Clip, "src_in" | "src_out" | "speed" | "transition">[]): number {
  if (!clips.length) return 0;
  return clipStarts(clips).at(-1)! + clipDuration(clips.at(-1)!);
}

/** Playhead `frames` frames from `time`, snapped to the frame grid and kept inside the video. */
export function stepTime(time: number, fps: number, frames: number, duration: number): number {
  const last = Math.max(0, Math.ceil(duration * fps) - 1);
  const frame = Math.min(last, Math.max(0, Math.round(time * fps) + frames));
  return frame / fps;
}
