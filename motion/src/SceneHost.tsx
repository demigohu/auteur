import React, { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, continueRender, delayRender } from "remotion";
import { FACES } from "./kit";
import { MODULES } from "./modules";

export type SceneProps = {
  /** The scene's code, already compiled to CommonJS by render.mjs. */
  js: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  /** Project images the scene may show, by id, as data URLs. */
  images: Record<string, string>;
};

// Names shadowed inside scene code, as a second line behind validate.mjs: a scene draws frames and has
// no business with the network, storage or the page around it.
const SHADOWED = [
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "Worker", "SharedWorker", "importScripts",
  "localStorage", "sessionStorage", "indexedDB", "caches", "navigator", "location", "window",
  "globalThis", "self", "top", "parent", "opener", "open", "frames",
];

// The network barrier: only this page's own server (the bundle) and inline data. Applies to everything
// loaded after it is added, which is all scene code.
const CSP =
  "default-src 'self' data: blob:; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'";

let hardened = false;

function harden() {
  if (hardened) return;
  hardened = true;
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = CSP;
  document.head.prepend(meta);
}

/** Function constructors reachable from any function value (`f.constructor("code")`) would run code
 * outside the shadowed scope; scene code has no use for them. Done after the host's own `new Function`. */
function disableFunctionConstructors() {
  const kinds = [function () {}, async function () {}, function* () {}, async function* () {}];
  for (const f of kinds) Object.defineProperty(Object.getPrototypeOf(f), "constructor", { value: undefined });
}

function load(js: string): React.ComponentType<Record<string, unknown>> {
  const module = { exports: {} as Record<string, unknown> };
  const require = (name: string) => {
    if (!(name in MODULES)) throw new Error(`Scenes can't import ${JSON.stringify(name)}`);
    return MODULES[name];
  };
  harden();
  const run = new Function("require", "module", "exports", ...SHADOWED, js);
  disableFunctionConstructors();
  run(require, module, module.exports);
  const Scene = module.exports.Scene ?? module.exports.default;
  if (typeof Scene !== "function") throw new Error("Scene code must export a component named Scene");
  return Scene as React.ComponentType<Record<string, unknown>>;
}

export const SceneHost: React.FC<SceneProps> = (props) => {
  const Scene = useMemo(() => load(props.js), [props.js]);
  const [handle] = useState(() => delayRender("Loading fonts"));
  useEffect(() => {
    Promise.all(FACES.map((f) => document.fonts.load(f))).then(() => continueRender(handle), () => continueRender(handle));
  }, [handle]);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Scene width={props.width} height={props.height} fps={props.fps} durationInFrames={props.durationInFrames} images={props.images} />
    </AbsoluteFill>
  );
};
