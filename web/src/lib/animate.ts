/** A clip's pose over time: keyframes and in/out animations. Mirrors api/src/auteur/animate.py: the
 * same effective keys, and straight lines between them (animate.test.ts checks against the Python). */
import type { Clip } from "./timeline";

export const ANIM_SAMPLES = 8;

export type Pose = { x: number; y: number; scale: number; rotation: number; opacity: number };
type Key = [number, Pose];
type AnimClip = Pick<Clip, "src_in" | "src_out" | "speed" | "transform" | "transform_keys" | "anim_in" | "anim_out">;

const lerp = (a: Pose, b: Pose, k: number): Pose => ({
  x: a.x + (b.x - a.x) * k,
  y: a.y + (b.y - a.y) * k,
  scale: a.scale + (b.scale - a.scale) * k,
  rotation: a.rotation + (b.rotation - a.rotation) * k,
  opacity: a.opacity + (b.opacity - a.opacity) * k,
});

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function baseKeys(c: AnimClip): Key[] {
  if (c.transform_keys.length) {
    return [...c.transform_keys].sort((a, b) => a.t - b.t).map((k) => [k.t, { x: k.x, y: k.y, scale: k.scale, rotation: k.rotation, opacity: k.opacity }]);
  }
  const t = c.transform;
  return [[0, { x: t?.x ?? 0, y: t?.y ?? 0, scale: t?.scale ?? 1, rotation: t?.rotation ?? 0, opacity: t?.opacity ?? 1 }]];
}

export function poseIn(keys: Key[], t: number): Pose {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, p0] = keys[i];
    const [t1, p1] = keys[i + 1];
    if (t < t1) return lerp(p0, p1, (t - t0) / Math.max(t1 - t0, 1e-6));
  }
  return keys[keys.length - 1][1];
}

function offset(kind: NonNullable<Clip["anim_in"]>["kind"], p: Pose, entering: boolean): Pose {
  const s = entering ? 1 : -1;
  switch (kind) {
    case "fade":
      return { ...p, opacity: 0 };
    case "zoom_in":
      return { ...p, scale: p.scale * (entering ? 0.6 : 1.4), opacity: 0 };
    case "zoom_out":
      return { ...p, scale: p.scale * (entering ? 1.4 : 0.6), opacity: 0 };
    case "slide_left":
      return { ...p, x: p.x + s };
    case "slide_right":
      return { ...p, x: p.x - s };
    case "slide_up":
      return { ...p, y: p.y + s };
    case "slide_down":
      return { ...p, y: p.y - s };
    case "spin":
      return { ...p, rotation: p.rotation - 180 * s, scale: p.scale * 0.3, opacity: 0 };
  }
}

function animKeys(kind: NonNullable<Clip["anim_in"]>["kind"], duration: number, base: Key[], start: number, entering: boolean): Key[] {
  const out: Key[] = [];
  for (let i = 0; i <= ANIM_SAMPLES; i++) {
    const u = i / ANIM_SAMPLES;
    const t = start + u * duration;
    const meet = poseIn(base, t);
    const k = entering ? 1 - (1 - u) ** 3 : u ** 3;
    const far = offset(kind, meet, entering);
    out.push([round4(t), entering ? lerp(far, meet, k) : lerp(meet, far, k)]);
  }
  return out;
}

/** The clip's pose as keys over its local time [0, duration] (animate.effective_keys). */
export function effectiveKeys(c: AnimClip): Key[] {
  const base = baseKeys(c);
  const d = (c.src_out - c.src_in) / (c.speed ?? 1);
  if (!c.anim_in && !c.anim_out) return base;
  const aIn = c.anim_in ? Math.min(c.anim_in.duration, d / 2) : 0;
  const aOut = c.anim_out ? Math.min(c.anim_out.duration, d / 2) : 0;
  let keys: Key[] = base.filter(([t]) => aIn < t && t < d - aOut);
  if (c.anim_in) keys = keys.concat(animKeys(c.anim_in.kind, aIn, base, 0, true));
  else if (base[0][0] > 0) keys.push([0, poseIn(base, 0)]);
  if (c.anim_out) keys = keys.concat(animKeys(c.anim_out.kind, aOut, base, d - aOut, false));
  // Stable sort by time, like Python's sorted().
  return keys.map((k, i) => [k, i] as const).sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1]).map(([k]) => k);
}

export const poseAt = (c: AnimClip, t: number): Pose => poseIn(effectiveKeys(c), t);
