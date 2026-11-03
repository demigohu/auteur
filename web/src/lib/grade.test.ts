import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { curve, isIdentity, NEUTRAL_GRADE, saturationMatrix, vignetteAt } from "./grade";

const g = (over: object) => ({ ...NEUTRAL_GRADE, ...over });

function hasUv(): boolean {
  try {
    execFileSync("uv", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

describe("grade", () => {
  it("leaves pixels alone at neutral", () => {
    expect(isIdentity(NEUTRAL_GRADE)).toBe(true);
    for (const x of [0, 0.25, 0.5, 1]) expect(curve(NEUTRAL_GRADE, x, 1)).toBeCloseTo(x, 6);
    expect(saturationMatrix(NEUTRAL_GRADE).split(" ").map(Number).slice(0, 5)).toEqual([1, 0, 0, 0, 0]);
    expect(vignetteAt(g({ vignette: 1 }), 0)).toBe(1);
  });

  it("counts any change as a grade", () => {
    expect(isIdentity(g({ fade: 0.1 }))).toBe(false);
    expect(isIdentity(g({ log: "slog3" }))).toBe(false);
  });

  it("warms red and cools blue with temperature", () => {
    const warm = g({ temperature: 0.5 });
    expect(curve(warm, 0.5, 0)).toBeGreaterThan(0.5);
    expect(curve(warm, 0.5, 2)).toBeLessThan(0.5);
  });

  // The preview must grade exactly like the export (api/src/auteur/grade.py).
  it.skipIf(!hasUv())("matches the Python export curve", () => {
    const grades = [
      { exposure: 0.5, contrast: 0.3, temperature: 0.4, tint: -0.2 },
      { shadows: 0.6, highlights: -0.5, fade: 0.4, shadow_tone: 0.8, shadow_hue: 195, highlight_tone: 0.6, highlight_hue: 30 },
      { exposure: -0.7, contrast: -0.5, saturation: -1, vignette: 0.5 },
      { log: "apple_log", contrast: 0.2 },
      { log: "slog3", temperature: 0.3 },
      { log: "vlog" },
      { log: "generic", fade: 0.2 },
    ].map(g);
    const py = `
import json, sys
from auteur.grade import curve
from auteur.timeline.models import Grade
gs = json.loads(sys.stdin.read())
print(json.dumps([[[curve(Grade(**g), i / 32, c) for c in range(3)] for i in range(33)] for g in gs]))
`;
    const expected: number[][][] = JSON.parse(
      execFileSync("uv", ["run", "--project", "../api", "python", "-c", py], { input: JSON.stringify(grades) }).toString(),
    );
    let worst = 0;
    grades.forEach((gr, k) => {
      for (let i = 0; i <= 32; i++) for (const c of [0, 1, 2] as const) worst = Math.max(worst, Math.abs(curve(gr, i / 32, c) - expected[k][i][c]));
    });
    expect(worst).toBeLessThan(1e-6);
  }, 60_000);
});
