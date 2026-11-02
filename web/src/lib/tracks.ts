/** SAM tracks as stored by the API (api/src/auteur/tracking.py), plus the same interpolation it uses. */

export type TrackData = {
  id: string;
  media_id: string;
  prompt: string;
  fps: number;
  width: number;
  height: number;
  total_frames: number;
  objects: Record<string, Record<string, [number, number, number, number]>>;
};

export type NormBox = [number, number, number, number]; // x1, y1, x2, y2 as fractions of the frame

const HOLD = 0.5; // default seconds a box is held or interpolated across missing detections

/** Sorted frame indices per object, computed once per track. */
const indexCache = new WeakMap<TrackData, Record<string, number[]>>();

function frameIndex(track: TrackData): Record<string, number[]> {
  let idx = indexCache.get(track);
  if (!idx) {
    idx = Object.fromEntries(
      Object.entries(track.objects).map(([oid, frames]) => [oid, Object.keys(frames).map(Number).sort((a, b) => a - b)]),
    );
    indexCache.set(track, idx);
  }
  return idx;
}

export function boxAt(track: TrackData, objectId: string, t: number, hold = HOLD): NormBox | null {
  const frames = track.objects[objectId];
  const keys = frameIndex(track)[objectId];
  if (!frames || !keys?.length) return null;
  const f = t * track.fps;
  // Binary search for the last detection at or before f.
  let lo = 0;
  let hi = keys.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (keys[mid] <= f) lo = mid;
    else hi = mid - 1;
  }
  const before = keys[lo] <= f ? keys[lo] : null;
  const after = before === null ? keys[0] : keys[lo + 1] ?? null;
  const norm = (b: [number, number, number, number]): NormBox => [
    b[0] / track.width,
    b[1] / track.height,
    b[2] / track.width,
    b[3] / track.height,
  ];
  if (before === null || after === null) {
    const near = (before ?? after)!;
    return Math.abs(near - f) <= hold * track.fps ? norm(frames[near]) : null;
  }
  if (after - before > 2 * hold * track.fps) return null;
  const k = (f - before) / (after - before);
  const a = frames[before];
  const b = frames[after];
  return norm([0, 1, 2, 3].map((i) => a[i] + (b[i] - a[i]) * k) as [number, number, number, number]);
}
