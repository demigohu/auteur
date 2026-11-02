/**
 * Port of api/src/auteur/grade.py so the preview grades exactly like the export.
 * Keep `curve` in lockstep with the Python version (scripts/check_grade_parity.mjs compares them).
 */
import type { Grade } from "./timeline";

const LUMA = [0.2126, 0.7152, 0.0722] as const;

function hueRgb(hue: number): [number, number, number] {
  // colorsys.hsv_to_rgb(h, 1, 1)
  const h = (((hue % 360) + 360) % 360) / 60;
  const i = Math.floor(h);
  const f = h - i;
  const q = 1 - f;
  return ([
    [1, f, 0],
    [q, 1, 0],
    [0, 1, f],
    [0, q, 1],
    [f, 0, 1],
    [1, 0, q],
  ] as [number, number, number][])[i % 6];
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

export function logToLinear(profile: Grade["log"], x: number): number {
  if (profile === "apple_log") {
    const [r0, rt, c, beta, gamma, delta] = [-0.05641088, 0.01, 47.28711236, 0.00964052, 0.08550479, 0.69336945];
    const pt = c * (rt - r0) ** 2;
    return x >= pt ? 2 ** ((x - delta) / gamma) - beta : Math.sqrt(Math.max(x, 0) / c) + r0;
  }
  if (profile === "vlog") return x < 0.181 ? (x - 0.125) / 5.6 : 10 ** ((x - 0.598206) / 0.241514) - 0.00873;
  // slog3, and "generic" decoded like S-Log3
  if (x >= 171.2102946929 / 1023) return 10 ** ((x * 1023 - 420) / 261.5) * 0.19 - 0.01;
  return ((x * 1023 - 95) * 0.01125) / (171.2102946929 - 95);
}

const linearToDisplay = (r: number) => 1 - Math.exp(-3.4 * Math.max(r, 0));

export function curve(g: Grade, input: number, channel: 0 | 1 | 2): number {
  if (g.log !== "none") input = linearToDisplay(logToLinear(g.log, input));
  let v = input * 2 ** g.exposure;
  const gains = [1 + 0.12 * g.temperature, 1 - 0.08 * g.tint, 1 - 0.12 * g.temperature];
  v = clamp01(v * gains[channel]);
  v += 0.25 * g.shadows * (1 - v) ** 3 * Math.min(1, v * 8 + 0.2);
  v += 0.25 * g.highlights * v ** 3;
  v = clamp01(v);
  const s = v * v * (3 - 2 * v);
  v += g.contrast * (s - v);
  const sh = hueRgb(g.shadow_hue)[channel];
  const hi = hueRgb(g.highlight_hue)[channel];
  v += 0.18 * g.shadow_tone * (sh - 0.5) * (1 - v) ** 2;
  v += 0.18 * g.highlight_tone * (hi - 0.5) * v ** 2;
  v = 0.16 * g.fade + v * (1 - 0.16 * g.fade);
  return clamp01(v);
}

export function isIdentity(g: Grade): boolean {
  return (
    g.log === "none" &&
    !g.exposure && !g.contrast && !g.saturation && !g.temperature && !g.tint && !g.highlights &&
    !g.shadows && !g.fade && !g.shadow_tone && !g.highlight_tone && !g.vignette
  );
}

/** feComponentTransfer tableValues per channel (piecewise linear, like ffmpeg's lut1d interp). */
export function tableValues(g: Grade, samples = 64): [string, string, string] {
  return ([0, 1, 2] as const).map((c) =>
    Array.from({ length: samples }, (_, i) => curve(g, i / (samples - 1), c).toFixed(4)).join(" "),
  ) as [string, string, string];
}

/** feColorMatrix values: the same saturation matrix the renderer feeds to colorchannelmixer. */
export function saturationMatrix(g: Grade): string {
  const s = 1 + g.saturation;
  const [r, gg, b] = LUMA;
  const rows = [
    [r + (1 - r) * s, gg - gg * s, b - b * s],
    [r - r * s, gg + (1 - gg) * s, b - b * s],
    [r - r * s, gg - gg * s, b + (1 - b) * s],
  ];
  return [...rows.map((row) => [...row, 0, 0].map((v) => v.toFixed(5)).join(" ")), "0 0 0 1 0"].join(" ");
}

/** Brightness multiplier at normalized radius r (0 center, 1 corner), as grade.vignette_factor. */
export function vignetteAt(g: Grade, r: number): number {
  const t = clamp01((r - 0.45) / 0.55);
  return 1 - 0.65 * g.vignette * t * t * (3 - 2 * t);
}

export const NEUTRAL_GRADE: Grade = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  fade: 0,
  shadow_hue: 200,
  shadow_tone: 0,
  highlight_hue: 35,
  highlight_tone: 0,
  vignette: 0,
  log: "none",
  look: null,
};
