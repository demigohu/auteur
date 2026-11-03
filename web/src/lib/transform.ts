/** Math for moving, scaling and rotating a clip on the preview canvas (Clip.transform, api models.Transform). */
import type { Transform } from "./timeline";

export const IDENTITY: Transform = { x: 0, y: 0, scale: 1, rotation: 0, flip_h: false, flip_v: false };

export type Rect = { left: number; top: number; width: number; height: number };
export type Point = { x: number; y: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, digits = 4) => Number(v.toFixed(digits));

/** Where a w x h composition sits inside a container when fitted (letterboxed), as the Player draws it. */
export function fitRect(containerW: number, containerH: number, w: number, h: number): Rect {
  const s = Math.min(containerW / w, containerH / h);
  const width = w * s;
  const height = h * s;
  return { left: (containerW - width) / 2, top: (containerH - height) / 2, width, height };
}

/** Center (in container pixels) of the transformed frame. */
export function centerOf(frame: Rect, t: Transform): Point {
  return { x: frame.left + frame.width * (0.5 + t.x), y: frame.top + frame.height * (0.5 + t.y) };
}

/** Moved by a pointer delta in container pixels. */
export function moveBy(t: Transform, dx: number, dy: number, frame: Rect): Transform {
  return { ...t, x: round(clamp(t.x + dx / frame.width, -1, 1)), y: round(clamp(t.y + dy / frame.height, -1, 1)) };
}

/** Scaled by how far the pointer moved from the center, relative to where the drag started. */
export function scaleBy(t: Transform, center: Point, from: Point, to: Point): Transform {
  const d0 = Math.hypot(from.x - center.x, from.y - center.y);
  const d1 = Math.hypot(to.x - center.x, to.y - center.y);
  if (d0 < 1) return t;
  return { ...t, scale: round(clamp((t.scale * d1) / d0, 0.1, 4), 3) };
}

/** Rotated by the angle the pointer swept around the center; `snap` rounds to 15 degrees. */
export function rotateBy(t: Transform, center: Point, from: Point, to: Point, snap: boolean): Transform {
  const a0 = Math.atan2(from.y - center.y, from.x - center.x);
  const a1 = Math.atan2(to.y - center.y, to.x - center.x);
  let deg = t.rotation + ((a1 - a0) * 180) / Math.PI;
  deg = ((((deg + 180) % 360) + 360) % 360) - 180; // wrap to -180..180
  if (snap) deg = Math.round(deg / 15) * 15;
  return { ...t, rotation: round(clamp(deg, -180, 180), 2) };
}

export const isIdentity = (t: Transform | null | undefined) =>
  !t || (t.x === 0 && t.y === 0 && t.scale === 1 && t.rotation === 0 && !t.flip_h && !t.flip_v);
