// Compares web/src/lib/grade.ts with api/src/auteur/grade.py on a few grades.
// Usage (from repo root): node web/scripts/check_grade_parity.mjs  (needs `uv` for the Python side)
import { execFileSync } from "node:child_process";
import { curve, NEUTRAL_GRADE } from "../src/lib/grade.ts";

const grades = [
  { exposure: 0.5, contrast: 0.3, temperature: 0.4, tint: -0.2 },
  { shadows: 0.6, highlights: -0.5, fade: 0.4, shadow_tone: 0.8, shadow_hue: 195, highlight_tone: 0.6, highlight_hue: 30 },
  { exposure: -0.7, contrast: -0.5, saturation: -1, vignette: 0.5 },
  { log: "apple_log", contrast: 0.2 },
  { log: "slog3", temperature: 0.3 },
  { log: "vlog" },
  { log: "generic", fade: 0.2 },
].map((g) => ({ ...NEUTRAL_GRADE, ...g }));

const py = `
import json, sys
from auteur.grade import curve
from auteur.timeline.models import Grade
gs = json.loads(sys.stdin.read())
print(json.dumps([[[curve(Grade(**g), i / 32, c) for c in range(3)] for i in range(33)] for g in gs]))
`;
const expected = JSON.parse(
  execFileSync("uv", ["run", "--project", "api", "python", "-c", py], { input: JSON.stringify(grades) }).toString(),
);
let worst = 0;
grades.forEach((g, k) => {
  for (let i = 0; i <= 32; i++) for (const c of [0, 1, 2]) worst = Math.max(worst, Math.abs(curve(g, i / 32, c) - expected[k][i][c]));
});
console.log(`max difference: ${worst.toExponential(2)}`);
process.exit(worst < 1e-6 ? 0 : 1);
