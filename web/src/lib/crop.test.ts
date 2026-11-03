import { describe, expect, it } from "vitest";
import { cropWindow } from "./crop";

// Expected values printed by models.CropRect.window in the API, so preview and export cut the same pixels.
describe("cropWindow", () => {
  it.each([
    [{ left: 0, right: 0.5, top: 0, bottom: 0 }, 320, 180, [0, 0, 160, 180]],
    [{ left: 0.2, right: 0.2, top: 0, bottom: 0 }, 1000, 500, [200, 0, 600, 500]],
    [{ left: 0.125, right: 0.05, top: 0.3, bottom: 0.15 }, 1921, 1081, [240, 324, 1584, 594]],
    [{ left: 0.45, right: 0.45, top: 0, bottom: 0 }, 3840, 2160, [1728, 0, 384, 2160]],
  ] as const)("matches the export for %o on %ix%i", (rect, w, h, expected) => {
    expect(cropWindow(rect, w, h)).toEqual(expected);
  });

  it("is the whole source without a crop", () => {
    expect(cropWindow(null, 1920, 1080)).toEqual([0, 0, 1920, 1080]);
  });
});
