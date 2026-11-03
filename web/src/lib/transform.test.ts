import { describe, expect, it } from "vitest";
import { centerOf, fitRect, IDENTITY, isIdentity, moveBy, rotateBy, scaleBy } from "./transform";

const frame = fitRect(1000, 1000, 1920, 1080); // letterboxed: 1000 x 562.5 at top 218.75

describe("transform", () => {
  it("fits the composition the way the player letterboxes it", () => {
    const near = (r: { left: number; top: number; width: number; height: number }) => [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 100) / 100 + 0); // + 0 turns -0 into 0
    expect(near(frame)).toEqual([0, 218.75, 1000, 562.5]);
    expect(near(fitRect(1000, 500, 1080, 1920))).toEqual([359.38, 0, 281.25, 500]);
  });

  it("moves in fractions of the frame and stops at a whole frame away", () => {
    expect(moveBy(IDENTITY, 250, -56.25, frame)).toMatchObject({ x: 0.25, y: -0.1 });
    expect(moveBy(IDENTITY, 5000, 0, frame).x).toBe(1);
    const c = centerOf(frame, { ...IDENTITY, x: 0.25 });
    expect([c.x, c.y].map((v) => Math.round(v))).toEqual([750, 500]);
  });

  it("scales by the pointer's distance from the center", () => {
    const c = { x: 500, y: 500 };
    expect(scaleBy(IDENTITY, c, { x: 600, y: 500 }, { x: 550, y: 500 }).scale).toBe(0.5);
    expect(scaleBy(IDENTITY, c, { x: 600, y: 500 }, { x: 5000, y: 500 }).scale).toBe(4);
  });

  it("rotates clockwise for a clockwise sweep, wraps and snaps", () => {
    const c = { x: 0, y: 0 };
    // Screen y points down, so right -> down is clockwise on screen.
    expect(rotateBy(IDENTITY, c, { x: 1, y: 0 }, { x: 0, y: 1 }, false).rotation).toBe(90);
    expect(rotateBy({ ...IDENTITY, rotation: 170 }, c, { x: 1, y: 0 }, { x: 0, y: 1 }, false).rotation).toBe(-100);
    expect(rotateBy(IDENTITY, c, { x: 1, y: 0 }, { x: 1, y: 0.2 }, true).rotation).toBe(15);
  });

  it("knows the identity", () => {
    expect(isIdentity(null)).toBe(true);
    expect(isIdentity({ ...IDENTITY, flip_h: true })).toBe(false);
  });
});
