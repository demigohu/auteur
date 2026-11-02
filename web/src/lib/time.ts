/** 00:12:07 style timecode (minutes:seconds:frames) for the editor's readouts. */
export function timecode(seconds: number, fps: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s - Math.floor(s)) * fps);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

export const toFrames = (seconds: number, fps: number) => Math.max(1, Math.round(seconds * fps));

export const clipDuration = (c: { src_in: number; src_out: number }) => c.src_out - c.src_in;

export function clipStarts(clips: { src_in: number; src_out: number }[]): number[] {
  let t = 0;
  return clips.map((c) => {
    const start = t;
    t += clipDuration(c);
    return start;
  });
}

export const timelineDuration = (clips: { src_in: number; src_out: number }[]) =>
  clips.reduce((sum, c) => sum + clipDuration(c), 0);
