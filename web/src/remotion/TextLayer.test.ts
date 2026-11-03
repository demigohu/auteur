import { describe, expect, it } from "vitest";
import type { TextItem } from "@/lib/timeline";
import { textState } from "./TextLayer";

const item = (over: Partial<TextItem>) => ({ id: "t", text: "one two three four", start: 1, end: 3, ...over }) as TextItem;

// Values checked in api/tests/test_textstyle.py against textlayer.text_state.
describe("textState", () => {
  it("pops in and fades out like the export", () => {
    const t = item({ anim_in: { kind: "pop", duration: 0.4 }, anim_out: { kind: "fade", duration: 0.5 } });
    expect(textState(t, 1.0)).toMatchObject({ alpha: 0, scale: 0.6 });
    expect(textState(t, 1.2).scale).toBeCloseTo(0.6 + 0.4 * (1 - 0.5 ** 3));
    expect(textState(t, 2.0)).toEqual({ alpha: 1, scale: 1, rise: 0, words: null });
    expect(textState(t, 2.75).alpha).toBeCloseTo(1 - 0.5 ** 3);
  });

  it("reveals word by word", () => {
    const t = item({ start: 0, end: 2, anim_in: { kind: "words", duration: 1 }, anim_out: null });
    expect([0, 0.3, 0.6, 0.99, 1.5].map((s) => textState(t, s).words)).toEqual([1, 2, 3, 4, null]);
  });
});
