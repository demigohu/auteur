"use client";

import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { TextItem } from "@/lib/timeline";

/**
 * Mirror of api/src/auteur/textlayer.py: same Montserrat files (public/fonts), same constants and
 * the same line breaks (taken from the text), so the preview matches the export.
 */
type Spec = { weight: 800 | 900; size: number; upper: boolean; stroke: number; shadow: boolean; mode: "plain" | "karaoke" | "box" | "reveal" };

const LOOK: Record<TextItem["look"], Spec> = {
  clean: { weight: 800, size: 0.045, upper: false, stroke: 0.09, shadow: false, mode: "plain" },
  bold: { weight: 900, size: 0.058, upper: true, stroke: 0.14, shadow: true, mode: "plain" },
  karaoke: { weight: 900, size: 0.058, upper: true, stroke: 0.14, shadow: true, mode: "karaoke" },
  box: { weight: 900, size: 0.055, upper: true, stroke: 0.12, shadow: true, mode: "box" },
  pop: { weight: 900, size: 0.064, upper: true, stroke: 0.14, shadow: true, mode: "reveal" },
};
const TITLE: Spec = { weight: 900, size: 0.08, upper: false, stroke: 0.09, shadow: true, mode: "plain" };
const CAPTION: Spec = { weight: 800, size: 0.035, upper: false, stroke: 0, shadow: false, mode: "plain" };
const LINE_HEIGHT = 1.18;
const BOX_PAD = 0.16;

export const specOf = (item: TextItem) => (item.style === "title" ? TITLE : item.style === "caption" ? CAPTION : LOOK[item.look]);

/** CSS families for TextItem.font (globals.css); Montserrat keeps the look's weight. */
export const FONT_FAMILY: Record<TextItem["font"], string> = {
  montserrat: "Montserrat", anton: "Auteur Anton", bebas: "Auteur Bebas", poppins: "Auteur Poppins",
  dmserif: "Auteur DM Serif", instrument: "Auteur Instrument", marker: "Auteur Marker", mono: "Auteur Mono",
};

export type TextState = { alpha: number; scale: number; rise: number; words: number | null };

/** Entrance/exit at timeline time t; mirrors textlayer.text_state (ease out entering, ease in leaving). */
export function textState(item: TextItem, t: number): TextState {
  const rest: TextState = { alpha: 1, scale: 1, rise: 0, words: null };
  const span = item.end - item.start;
  const aIn = item.anim_in ? Math.min(item.anim_in.duration, span / 2) : 0;
  const aOut = item.anim_out ? Math.min(item.anim_out.duration, span / 2) : 0;
  const local = t - item.start;
  let anim: TextItem["anim_in"] = null;
  let u = 1;
  if (item.anim_in && local < aIn) {
    anim = item.anim_in;
    u = Math.max(local, 0) / aIn;
  } else if (item.anim_out && local > span - aOut) {
    anim = item.anim_out;
    u = Math.min(span - local, aOut) / aOut;
  } else return rest;
  const e = 1 - (1 - u) ** 3;
  const n = item.text.split(/\s+/).filter(Boolean).length;
  switch (anim!.kind) {
    case "fade":
      return { ...rest, alpha: e };
    case "pop":
      return { ...rest, alpha: e, scale: 0.6 + 0.4 * e };
    case "slide_up":
      return { ...rest, alpha: e, rise: 0.06 * (1 - e) };
    case "words":
      return { ...rest, words: u < 1 ? Math.min(n, Math.floor(u * n) + 1) : n };
  }
}

export function activeWord(item: TextItem, t: number): number {
  let idx = -1;
  item.words.forEach((w, i) => {
    if (w.start <= t + 1e-6) idx = i;
  });
  return idx;
}

export function TextLayer({ item }: { item: TextItem }) {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const sp = specOf(item);
  // The text's own style overrides its look (textlayer.style).
  const px = Math.max(8, pyRound(H * (item.size ?? sp.size)));
  const stroke = pyRound(px * (item.outline ?? sp.stroke));
  const shadow = item.shadow ?? sp.shadow;
  const boxed = Boolean(item.background) || item.style === "caption";
  const bg = item.background ? hexAlpha(item.background, item.background_opacity) : "rgba(0,0,0,0.63)";
  const lh = px * LINE_HEIGHT;
  const lines = item.text.split("\n").map((l) => l.split(/\s+/).filter(Boolean));
  const active = item.words.length ? activeWord(item, item.start + frame / fps) : -1;
  const st = textState(item, item.start + frame / fps);
  const top = item.y * H - (lh * lines.length) / 2;
  let k = 0;

  return (
    <AbsoluteFill
      style={{
        opacity: st.alpha < 1 ? st.alpha : undefined,
        // Scaled about the text's own center, then moved down, as textlayer.draw_item does.
        transform: st.scale !== 1 || st.rise ? `translateY(${st.rise * H}px) scale(${st.scale})` : undefined,
        transformOrigin: `${item.x * W}px ${item.y * H}px`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          width: W,
          top,
          fontFamily: `"${FONT_FAMILY[item.font]}", sans-serif`,
          fontWeight: item.font === "montserrat" ? sp.weight : 400,
          fontSize: px,
          color: "#fff",
          textAlign: "center",
          whiteSpace: "pre",
          filter: shadow ? `drop-shadow(0 ${px * 0.06}px 0 rgba(0,0,0,0.43))` : undefined,
          transform: `translateX(${(item.x - 0.5) * W}px)`,
        }}
      >
        <div
          data-text-id={item.id}
          style={{
            display: "inline-block",
            padding: boxed ? px / 3 : 0,
            margin: boxed ? -px / 3 : 0,
            borderRadius: px / 3,
            background: boxed ? bg : undefined,
          }}
        >
          {lines.map((line, li) => (
            <div key={li} style={{ height: lh, lineHeight: `${lh}px` }}>
              {line.map((word, wi) => {
                const i = k++;
                const spoken = item.words[i];
                const isActive = i === active;
                const hidden = (sp.mode === "reveal" && item.words.length > 0 && i > active) || (st.words !== null && i >= st.words);
                let color = item.text_color;
                if (spoken?.emphasis) color = item.color;
                if ((sp.mode === "karaoke" || sp.mode === "reveal") && isActive) color = item.color;
                const wordBox = sp.mode === "box" && isActive;
                const pad = px * BOX_PAD;
                return (
                  <span key={wi}>
                    {wi > 0 ? " " : ""}
                    <span
                      style={{
                        visibility: hidden ? "hidden" : undefined,
                        color: wordBox ? "#111" : color,
                        WebkitTextStroke: !wordBox && stroke ? `${stroke * 2}px ${item.outline_color}` : undefined,
                        paintOrder: "stroke fill",
                        ...(wordBox && {
                          background: item.color,
                          borderRadius: pad * 1.2,
                          padding: `${px * 0.62 - px * 0.5}px ${pad}px`,
                          margin: `0 ${-pad}px`,
                          boxDecorationBreak: "clone",
                        }),
                      }}
                    >
                      {sp.upper ? word.toUpperCase() : word}
                    </span>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
}

// Python's round() sends halves to the even neighbour; match it so sizes agree with the export.
function pyRound(v: number): number {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

function hexAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(alpha * 255) / 255})`;
}
