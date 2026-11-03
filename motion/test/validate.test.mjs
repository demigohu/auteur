import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "../validate.mjs";

const ok = `import { AbsoluteFill, useCurrentFrame } from "remotion";
import { fonts } from "@auteur/kit";
export const Scene = () => <AbsoluteFill style={{ fontFamily: fonts.inter }}>{useCurrentFrame()}</AbsoluteFill>;`;

test("compiles a plain scene", async () => {
  const r = await compile(ok);
  assert.equal(r.error, undefined);
  assert.match(r.js, /require\("remotion"\)/);
});

const attacks = {
  "network": `export const Scene = () => { fetch("/api"); return null; };`,
  "storage": `export const Scene = () => { localStorage.x = 1; return null; };`,
  "function constructor": `export const Scene = () => { ({}).constructor.constructor("return 1")(); return null; };`,
  "bracket globals": `export const Scene = () => { globalThis["fe" + "tch"]("x"); return null; };`,
  "node import": `import fs from "fs"; export const Scene = () => null;`,
  "dynamic import": `export const Scene = () => { import("x"); return null; };`,
  "remote image": `import { Img } from "remotion"; export const Scene = () => <Img src="https://evil.example/a.png" />;`,
  "cookies": `export const Scene = () => <div>{document.cookie}</div>;`,
  "raw html": `export const Scene = () => <div dangerouslySetInnerHTML={{ __html: "<img>" }} />;`,
  "computed require": `const m = "f" + "s"; const x = require(m); export const Scene = () => null;`,
};

for (const [name, code] of Object.entries(attacks)) {
  test(`rejects ${name}`, async () => {
    const r = await compile(code);
    assert.ok(r.error, `expected an error for ${name}`);
    assert.equal(r.js, undefined);
  });
}

test("allows on-screen words and CSS keys that look like globals", async () => {
  const code = `import { AbsoluteFill } from "remotion";
export const Scene = () => (
  <AbsoluteFill style={{ top: 0, position: "absolute" }}>
    <div style={{ top: "10%" }}>Fetch your window location from the document: https is fine in text?</div>
    {"Location: Jakarta, self-made"}
  </AbsoluteFill>
);`;
  const r = await compile(code.replace("https is fine in text?", "no protocol here"));
  assert.equal(r.error, undefined);
});

test("rejects a property name assembled from strings", async () => {
  const folded = await compile(`export const Scene = () => { const o = {}; o["con" + "structor"]; return null; };`);
  assert.match(folded.error, /constructor/);
  const built = await compile("export const Scene = ({ k }) => { const o = {}; o[`${k}x`]; return null; };");
  assert.match(built.error, /built from strings/);
});

test("reports syntax errors with a line", async () => {
  const r = await compile(`export const Scene = () => <div>;`);
  assert.match(r.error, /^Syntax error: line 1/);
});

test("requires a Scene export", async () => {
  const r = await compile(`export const Intro = () => null;`);
  assert.match(r.error, /Scene/);
});
