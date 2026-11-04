import { describe, expect, it } from "vitest";
import type { TranscriptView } from "@/lib/api";
import { wordCuts } from "./TranscriptTab";

const w = (text: string, src_start: number) => ({ text, src_start, src_end: src_start + 0.05, start: src_start, end: src_start + 0.05, filler: false });
const view: TranscriptView = {
  clips: [{ clip_id: "c1", media_id: "m", start: 0, words: [w("So", 0), w("um", 0.45), w("this", 1.01), w("is", 1.25), w("great", 1.6)] }],
  missing: [],
  missing_seconds: 0,
};

describe("wordCuts", () => {
  it("cuts from a word to the next kept word, one cut per run", () => {
    expect(wordCuts(view, new Set(["0:1"]))).toEqual([{ clip_id: "c1", src_start: 0.45, src_end: 1.01 }]);
    expect(wordCuts(view, new Set(["0:1", "0:2", "0:3"]))).toEqual([{ clip_id: "c1", src_start: 0.45, src_end: 1.6 }]);
    expect(wordCuts(view, new Set(["0:1", "0:3"]))).toHaveLength(2);
  });

  it("runs to the end of the clip from its last words", () => {
    expect(wordCuts(view, new Set(["0:4"]))).toEqual([{ clip_id: "c1", src_start: 1.6, src_end: 1e6 }]);
  });
});
