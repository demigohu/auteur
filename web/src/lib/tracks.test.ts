import { describe, expect, it } from "vitest";
import { boxAt, type TrackData } from "./tracks";

const track: TrackData = {
  id: "t", media_id: "m", prompt: "dog", fps: 10, width: 100, height: 50, total_frames: 100,
  objects: { "1": { "10": [0, 0, 10, 10], "12": [20, 10, 30, 20], "40": [50, 0, 60, 10] } },
};

describe("boxAt", () => {
  it("returns the detection as fractions of the frame", () => {
    expect(boxAt(track, "1", 1)).toEqual([0, 0, 0.1, 0.2]);
  });

  it("interpolates between nearby detections", () => {
    expect(boxAt(track, "1", 1.1)).toEqual([0.1, 0.1, 0.2, 0.3]);
  });

  it("drops the box across a gap longer than twice the hold", () => {
    expect(boxAt(track, "1", 2.5)).toBeNull();
  });

  it("holds the edge detections for half a second", () => {
    expect(boxAt(track, "1", 0.6)).toEqual([0, 0, 0.1, 0.2]);
    expect(boxAt(track, "1", 0.4)).toBeNull();
    expect(boxAt(track, "1", 4.4)).toEqual([0.5, 0, 0.6, 0.2]);
  });

  it("knows nothing about unknown objects", () => {
    expect(boxAt(track, "9", 1)).toBeNull();
  });
});
