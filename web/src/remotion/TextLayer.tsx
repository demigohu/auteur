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

const specOf = (item: TextItem) => (item.style === "title" ? TITLE : item.style === "caption" ? CAPTION : LOOK[item.look]);

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
  const px = Math.max(8, Math.round(H * sp.size));
  const stroke = Math.round(px * sp.stroke);
  const lh = px * LINE_HEIGHT;
  const lines = item.text.split("\n").map((l) => l.split(/\s+/).filter(Boolean));
  const active = item.words.length ? activeWord(item, item.start + frame / fps) : -1;
  const top = item.y * H - (lh * lines.length) / 2;
  let k = 0;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 0,
          width: W,
          top,
          fontFamily: "Montserrat, sans-serif",
          fontWeight: sp.weight,
          fontSize: px,
          color: "#fff",
          textAlign: "center",
          whiteSpace: "pre",
          filter: sp.shadow ? `drop-shadow(0 ${px * 0.06}px 0 rgba(0,0,0,0.43))` : undefined,
          transform: `translateX(${(item.x - 0.5) * W}px)`,
        }}
      >
        <div
          style={{
            display: "inline-block",
            padding: item.style === "caption" ? px / 3 : 0,
            margin: item.style === "caption" ? -px / 3 : 0,
            borderRadius: px / 3,
            background: item.style === "caption" ? "rgba(0,0,0,0.63)" : undefined,
          }}
        >
          {lines.map((line, li) => (
            <div key={li} style={{ height: lh, lineHeight: `${lh}px` }}>
              {line.map((word, wi) => {
                const i = k++;
                const spoken = item.words[i];
                const isActive = i === active;
                const hidden = sp.mode === "reveal" && item.words.length > 0 && i > active;
                let color = "#fff";
                if (spoken?.emphasis) color = item.color;
                if ((sp.mode === "karaoke" || sp.mode === "reveal") && isActive) color = item.color;
                const boxed = sp.mode === "box" && isActive;
                const pad = px * BOX_PAD;
                return (
                  <span key={wi}>
                    {wi > 0 ? " " : ""}
                    <span
                      style={{
                        visibility: hidden ? "hidden" : undefined,
                        color: boxed ? "#111" : color,
                        WebkitTextStroke: !boxed && stroke ? `${stroke * 2}px #000` : undefined,
                        paintOrder: "stroke fill",
                        ...(boxed && {
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
