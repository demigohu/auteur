import { describe, expect, it } from "vitest";
import { clipDuration, clipStarts, timecode, timelineDuration, toFrames } from "./time";

const clip = (src_in: number, src_out: number, extra: object = {}) => ({ src_in, src_out, speed: 1, transition: null, ...extra });

describe("time", () => {
  it("formats minutes, seconds and frames", () => {
    expect(timecode(0, 30)).toBe("00:00:00");
    expect(timecode(75.5, 30)).toBe("01:15:15");
    expect(timecode(-3, 30)).toBe("00:00:00");
  });

  it("never rounds a clip to zero frames", () => {
    expect(toFrames(0.001, 30)).toBe(1);
    expect(toFrames(2, 24)).toBe(48);
  });

  it("divides source length by speed", () => {
    expect(clipDuration(clip(1, 5, { speed: 2 }))).toBe(2);
  });

  it("pulls a clip back over the previous one by its crossfade", () => {
    const clips = [clip(0, 4), clip(0, 3, { transition: { kind: "crossfade", duration: 1 } }), clip(0, 2, { transition: { kind: "dip_black", duration: 0.5 } })];
    expect(clipStarts(clips)).toEqual([0, 3, 6]);
    expect(timelineDuration(clips)).toBe(8);
  });

  it("ignores a crossfade on the first clip", () => {
    expect(clipStarts([clip(0, 2, { transition: { kind: "crossfade", duration: 1 } })])).toEqual([0]);
    expect(timelineDuration([])).toBe(0);
  });
});
