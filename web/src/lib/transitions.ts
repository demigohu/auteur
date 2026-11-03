/** How overlapping transitions draw in the preview, mirroring ffmpeg's xfade (render.XFADE). `q` is how
 * far the transition has run, 0 -> 1 (xfade's own `progress` runs 1 -> 0, so p = 1 - q below).
 * The incoming clip is drawn on top of the outgoing one. */
import type { Transition } from "./timeline";

export const DIPS = new Set<Transition["kind"]>(["dip_black", "dip_white"]);
export const overlaps = (t: Transition | null | undefined): t is Transition => Boolean(t) && !DIPS.has(t!.kind);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export type LayerStyle = { opacity?: number; transform?: string; clipPath?: string; maskImage?: string };

/** The incoming clip at progress q. */
export function incoming(kind: Transition["kind"], q: number, W: number, H: number): LayerStyle {
  const p = 1 - q;
  switch (kind) {
    case "crossfade":
      return { opacity: q };
    case "slide_left":
      return { transform: `translateX(${p * 100}%)` };
    case "slide_right":
      return { transform: `translateX(${-p * 100}%)` };
    case "slide_up":
      return { transform: `translateY(${p * 100}%)` };
    case "slide_down":
      return { transform: `translateY(${-p * 100}%)` };
    case "wipe_left":
      return { clipPath: `inset(0 0 0 ${p * 100}%)` };
    case "wipe_right":
      return { clipPath: `inset(0 ${p * 100}% 0 0)` };
    case "circle":
      return { maskImage: circleMask(p, W, H) };
    case "zoom":
      return { opacity: 1 - smoothstep(0, 0.5, p) };
    default:
      return {};
  }
}

/** The outgoing clip at progress q (only kinds that move it). */
export function outgoing(kind: Transition["kind"], q: number): LayerStyle {
  const p = 1 - q;
  switch (kind) {
    case "slide_left":
      return { transform: `translateX(${-q * 100}%)` };
    case "slide_right":
      return { transform: `translateX(${q * 100}%)` };
    case "slide_up":
      return { transform: `translateY(${-q * 100}%)` };
    case "slide_down":
      return { transform: `translateY(${q * 100}%)` };
    case "zoom":
      // xfade samples ever closer to the center: a zoom of 1/zf, a flat color at zf = 0.
      return { transform: `scale(${1 / Math.max(smoothstep(0.5, 1, p), 1 / 400)})` };
    default:
      return {};
  }
}

/** circleopen: the new clip shows with weight 1 - smoothstep(0, 1, r / z + (p - 0.5) * 3), where r is the
 * distance from the center and z the half diagonal; sampled into gradient stops. */
export function circleMask(p: number, W: number, H: number): string {
  const z = Math.hypot(W / 2, H / 2);
  const shift = (p - 0.5) * 3;
  const stops: string[] = [];
  for (let k = 0; k <= 8; k++) {
    const s = k / 8; // smoothstep input
    const r = (s - shift) * z;
    stops.push(`rgba(0,0,0,${(1 - smoothstep(0, 1, s)).toFixed(3)}) ${r.toFixed(1)}px`);
  }
  return `radial-gradient(circle ${z.toFixed(1)}px at 50% 50%, ${stops.join(", ")})`;
}
