import { describe, expect, it } from "vitest";
import { circleMask, incoming, outgoing, overlaps, smoothstep } from "./transitions";

// Expectations come from measuring ffmpeg xfade (red|blue clip into green|yellow) at q = 0.25.
describe("transitions", () => {
  it("knows which kinds overlap", () => {
    expect(overlaps({ kind: "slide_left", duration: 0.5 })).toBe(true);
    expect(overlaps({ kind: "dip_black", duration: 0.5 })).toBe(false);
    expect(overlaps(null)).toBe(false);
  });

  it("slides both clips the same way", () => {
    expect(outgoing("slide_left", 0.25).transform).toBe("translateX(-25%)"); // red half ends at 0.25 W
    expect(incoming("slide_left", 0.25, 320, 180).transform).toBe("translateX(75%)"); // green from 0.75 W
    expect(incoming("slide_up", 0.25, 320, 180).transform).toBe("translateY(75%)"); // new clip in the bottom quarter
  });

  it("wipes reveal the new clip in place", () => {
    expect(incoming("wipe_left", 0.25, 320, 180).clipPath).toBe("inset(0 0 0 75%)"); // shows x > 240
    expect(incoming("wipe_right", 0.25, 320, 180).clipPath).toBe("inset(0 75% 0 0)"); // shows x < 80
  });

  it("zooms into the old clip, then fades to the new one", () => {
    expect(outgoing("zoom", 0.25).transform).toBe("scale(2)"); // zf = smoothstep(0.5, 1, 0.75) = 0.5
    expect(incoming("zoom", 0.25, 320, 180).opacity).toBe(0);
    expect(incoming("zoom", 0.75, 320, 180).opacity).toBeCloseTo(0.5);
  });

  it("opens the circle from the center", () => {
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    // Halfway, the center is fully new and the corner (r = z) fully old.
    const mask = circleMask(0.5, 320, 180);
    expect(mask).toMatch(/^radial-gradient\(circle 183\.6px at 50% 50%, rgba\(0,0,0,1\.000\) 0\.0px/);
    expect(mask).toMatch(/rgba\(0,0,0,0\.000\) 183\.6px\)$/);
  });
});
