import type { CropKey, VolumeKey } from "./timeline";

/** Piecewise-linear value at clip-local time t, held flat before the first and after the last key
 * (same as render._lerp_expr). */
function lerp<K extends { t: number }>(keys: K[], t: number, get: (k: K) => number, fallback: number): number {
  if (!keys.length) return fallback;
  if (t <= keys[0].t) return get(keys[0]);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t < b.t) return get(a) + (get(b) - get(a)) * ((t - a.t) / Math.max(b.t - a.t, 1e-3));
  }
  return get(keys[keys.length - 1]);
}

export const cropAt = (keys: CropKey[], t: number) => ({
  cx: lerp(keys, t, (k) => k.cx, 0.5),
  cy: lerp(keys, t, (k) => k.cy, 0.5),
});

export const volumeAt = (keys: VolumeKey[], t: number) => lerp(keys, t, (k) => k.v, 1);

/** Insert or replace the key at time t (within half a frame), keeping keys sorted. */
export function upsertKey<K extends { t: number }>(keys: K[], key: K, tolerance = 1 / 60): K[] {
  return [...keys.filter((k) => Math.abs(k.t - key.t) > tolerance), key].sort((a, b) => a.t - b.t);
}
