import type { CropRect } from "./timeline";

/** x, y, width, height (source pixels) left after cutting the edges; mirrors models.CropRect.window. */
export function cropWindow(rect: CropRect | null | undefined, w: number, h: number): [number, number, number, number] {
  if (!rect) return [0, 0, w, h];
  const pyRound = (v: number) => {
    const r = Math.round(v);
    return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
  };
  const cw = Math.max(pyRound(w * (1 - rect.left - rect.right)), Math.floor(w / 10));
  const ch = Math.max(pyRound(h * (1 - rect.top - rect.bottom)), Math.floor(h / 10));
  return [pyRound(w * rect.left), pyRound(h * rect.top), cw - (cw % 2), ch - (ch % 2)];
}

/** The whole w x h picture scaled to fit inside the frame, even sizes (render.fit_size). */
export function fitSize(w: number, h: number, W: number, H: number): [number, number] {
  const s = Math.min(W / w, H / h);
  const even = (v: number) => {
    const r = Math.round(v / 2);
    // Python rounds halves to even
    return Math.max(2, (Math.abs((v / 2) % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r) * 2);
  };
  return [even(w * s), even(h * s)];
}
