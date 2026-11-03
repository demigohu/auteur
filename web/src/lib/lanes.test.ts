import { describe, expect, it } from "vitest";
import { laneCount, packLanes } from "./lanes";

describe("packLanes", () => {
  it("keeps items that follow each other on one row", () => {
    expect(packLanes([[0, 2], [2, 4], [4, 5]])).toEqual([0, 0, 0]);
  });

  it("stacks overlapping items and reuses freed rows", () => {
    expect(packLanes([[0, 4], [1, 3], [2, 5], [3.5, 6]])).toEqual([0, 1, 2, 1]);
  });

  it("works on unsorted items and answers in their order", () => {
    expect(packLanes([[5, 8], [0, 6], [1, 2]])).toEqual([1, 0, 1]); // row 0 is busy until 6, so 5-8 takes row 1
  });

  it("counts at least one row", () => {
    expect(laneCount([])).toBe(1);
    expect(laneCount([0, 2, 1])).toBe(3);
  });
});
