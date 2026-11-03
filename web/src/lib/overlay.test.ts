import { describe, expect, it } from "vitest";
import { boxOf, overlayRect } from "./overlay";

// Expected values printed by api/src/auteur/render.py overlay_rect, so the preview places B-roll on the
// same pixels as the export.
const CASES: [Parameters<typeof overlayRect>[0], number, number, [number, number, number, number]][] = [
  [{ layout: "kanan_atas", box: null }, 1920, 1080, [1210, 43, 652, 368]],
  [{ layout: "kiri_bawah", box: null }, 1080, 1920, [32, 1190, 368, 652]],
  [{ layout: "full", box: null }, 1080, 1350, [0, 0, 1080, 1350]],
  [{ layout: "full", box: { x: 0.3, y: 0.7, scale: 0.5 } }, 1920, 1080, [96, 486, 960, 540]],
  [{ layout: "full", box: { x: 0.125, y: 0.125, scale: 0.25 } }, 1080, 1080, [0, 0, 270, 270]],
  [{ layout: "full", box: { x: 1.2, y: -0.1, scale: 0.33 } }, 1080, 1350, [1118, -358, 356, 446]],
];

describe("overlayRect", () => {
  it.each(CASES)("matches the export for %o at %ix%i", (item, w, h, expected) => {
    expect(overlayRect(item, w, h)).toEqual(expected);
  });

  it("starts a drag from where a preset puts the picture", () => {
    const box = boxOf({ layout: "kanan_atas", box: null });
    expect(overlayRect({ layout: "full", box }, 1920, 1080)).toEqual(overlayRect({ layout: "kanan_atas", box: null }, 1920, 1080));
  });
});
