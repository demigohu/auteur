import type { Overlay } from "./timeline";

/** Mirrors render.overlay_rect: picture-in-picture is 34% of the frame in a corner, or a free box. */
const LAYOUT_BOX: Record<string, [number, number]> = {
  kanan_atas: [0.63, 0.04], kiri_atas: [0.03, 0.04], kanan_bawah: [0.63, 0.62], kiri_bawah: [0.03, 0.62],
};
export const PIP_SCALE = 0.34;

const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
// Python's round() rounds halves to even; Math.round rounds them up. Match the export.
const pyRound = (v: number) => {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/** x, y, w, h of a B-roll overlay in output pixels. */
export function overlayRect(item: Pick<Overlay, "layout" | "box">, W: number, H: number): [number, number, number, number] {
  if (item.box) {
    const w = even(W * item.box.scale);
    const h = even(H * item.box.scale);
    return [pyRound(W * item.box.x - w / 2), pyRound(H * item.box.y - h / 2), w, h];
  }
  if (item.layout === "full") return [0, 0, W, H];
  const [fx, fy] = LAYOUT_BOX[item.layout];
  return [pyRound(W * fx), pyRound(H * fy), even(W * PIP_SCALE), even(H * PIP_SCALE)];
}

/** The free box equal to where an overlay is now (to start dragging from a preset place). */
export function boxOf(item: Pick<Overlay, "layout" | "box">): NonNullable<Overlay["box"]> {
  if (item.box) return item.box;
  if (item.layout === "full") return { x: 0.5, y: 0.5, scale: 1 };
  const [fx, fy] = LAYOUT_BOX[item.layout];
  return { x: fx + PIP_SCALE / 2, y: fy + PIP_SCALE / 2, scale: PIP_SCALE };
}
