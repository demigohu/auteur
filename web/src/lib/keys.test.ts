import { describe, expect, it } from "vitest";
import { cropAt, upsertKey, volumeAt } from "./keys";

describe("keyframes", () => {
  const keys = [{ t: 1, v: 0 }, { t: 3, v: 1 }];

  it("holds the first and last key outside their range", () => {
    expect(volumeAt(keys, 0)).toBe(0);
    expect(volumeAt(keys, 9)).toBe(1);
  });

  it("interpolates linearly between keys", () => {
    expect(volumeAt(keys, 2)).toBeCloseTo(0.5);
  });

  it("uses defaults with no keys", () => {
    expect(volumeAt([], 1)).toBe(1);
    expect(cropAt([], 1)).toEqual({ cx: 0.5, cy: 0.5 });
  });

  it("replaces a key at the same time and keeps keys sorted", () => {
    const out = upsertKey([{ t: 2, v: 1 }, { t: 0, v: 0 }], { t: 2.001, v: 0.3 });
    expect(out).toEqual([{ t: 0, v: 0 }, { t: 2.001, v: 0.3 }]);
  });
});
