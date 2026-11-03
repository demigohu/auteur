import { describe, expect, it } from "vitest";
import { clipLength, groupOf, isUploadable } from "./media";

const file = (type: string) => ({ type }) as File;

describe("media", () => {
  it("accepts footage, audio and the picture formats the API converts", () => {
    for (const t of ["video/mp4", "video/webm", "audio/mpeg", "image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(isUploadable(file(t))).toBe(true);
    }
    for (const t of ["image/svg+xml", "application/pdf", ""]) expect(isUploadable(file(t))).toBe(false);
  });

  it("starts a still at 5 seconds and everything else whole", () => {
    expect(clipLength({ image: "still", duration: 60 })).toBe(5);
    expect(clipLength({ image: "gif", duration: 6.4 })).toBe(6.4);
    expect(clipLength({ image: null, duration: 12.3456 })).toBe(12.346);
  });

  it("sorts media into the bin's groups", () => {
    expect(groupOf({ kind: "audio", image: null, scene_id: null })).toBe("audio");
    expect(groupOf({ kind: "video", image: null, scene_id: "s1" })).toBe("scenes");
    expect(groupOf({ kind: "video", image: "gif", scene_id: null })).toBe("pictures");
    expect(groupOf({ kind: "video", image: null, scene_id: null })).toBe("footage");
  });
});
