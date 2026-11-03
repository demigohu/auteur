import type { NewProject } from "@/lib/api";

export const ASPECTS: { value: NewProject["aspect"]; use: string; color: string }[] = [
  { value: "16:9", use: "YouTube, landscape", color: "var(--blue)" },
  { value: "9:16", use: "Reels, TikTok, Shorts", color: "var(--tomato)" },
  { value: "1:1", use: "Square post", color: "var(--lime)" },
  { value: "4:5", use: "Instagram feed", color: "var(--pink)" },
];

const SIZE: Record<NewProject["aspect"], [number, number]> = { "16:9": [44, 25], "9:16": [22, 39], "1:1": [32, 32], "4:5": [28, 35] };

/** A frame outline at the format's proportions, with a play mark. */
export function AspectGlyph({ aspect, active, color }: { aspect: NewProject["aspect"]; active?: boolean; color?: string }) {
  const [w, h] = SIZE[aspect];
  return (
    <svg width="48" height="42" viewBox="0 0 48 42" aria-hidden>
      <rect
        x={(48 - w) / 2}
        y={(42 - h) / 2}
        width={w}
        height={h}
        rx="3"
        fill={color ?? (active ? "var(--lime)" : "transparent")}
        stroke={active ? "var(--bg)" : "var(--text)"}
        strokeWidth="2"
      />
      <path d="M21.5 17.5v7l6-3.5z" fill={color || active ? "var(--ink)" : "var(--text)"} />
    </svg>
  );
}
