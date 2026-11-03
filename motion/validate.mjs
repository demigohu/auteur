// Static checks on scene code before it is rendered. Scene code comes from a model that read user
// text (briefs, transcripts, file names), so it is treated as untrusted: it may only draw frames.
//
// The code is parsed (not grepped), so words in on-screen text or CSS keys like `top` are fine; only
// names used as code count. This is the first of three layers: SceneHost also shadows browser globals
// and sets a Content-Security-Policy that blocks the network, and Function constructors are disabled.
import { parse } from "acorn";
import { ancestor, simple } from "acorn-walk";
import { transform } from "esbuild";

export const ALLOWED_IMPORTS = new Set([
  "react", "react/jsx-runtime", "remotion", "@remotion/noise", "@remotion/paths", "@remotion/shapes",
  "@remotion/transitions", "@remotion/transitions/clock-wipe", "@remotion/transitions/fade",
  "@remotion/transitions/flip", "@remotion/transitions/iris", "@remotion/transitions/slide",
  "@remotion/transitions/wipe", "@auteur/kit",
]);

const MAX_BYTES = 80_000;

// Globals a scene has no use for: the network, storage, the page, and ways to run code from strings.
const GLOBALS = new Set([
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "Worker", "SharedWorker", "importScripts",
  "localStorage", "sessionStorage", "indexedDB", "caches", "cookieStore", "eval", "Function", "globalThis",
  "window", "self", "top", "parent", "opener", "frames", "document", "navigator", "location", "Reflect",
  "Proxy", "WebAssembly", "postMessage", "require", "module", "exports", "process", "setInterval",
]);

// Properties that reach Function (and so the real globals) through any object, or leak data.
const PROPS = new Set([
  "constructor", "__proto__", "prototype", "__defineGetter__", "__defineSetter__", "__lookupGetter__",
  "__lookupSetter__", "cookie", "sendBeacon", "localStorage", "sessionStorage", "contentWindow", "ownerDocument",
  "defaultView", "getRootNode",
]);

const TAGS = new Set(["script", "iframe", "object", "embed", "link", "meta", "base", "frame", "frameset", "portal"]);
const KEYS = new Set(["dangerouslySetInnerHTML", "srcDoc", "__proto__", "formAction", "href"]);

const REMOTE = /^\s*(https?:|\/\/|ftp:|ws:|wss:|javascript:)|url\(\s*['"]?\s*(https?:|\/\/)/i;

const hasStringPart = (node) => {
  let found = false;
  simple(node, { Literal: (n) => (found ||= typeof n.value === "string"), TemplateLiteral: () => (found = true) });
  return found || node.type === "TemplateLiteral";
};

function inspect(esm) {
  const problems = [];
  const ast = parse(esm, { ecmaVersion: "latest", sourceType: "module" });
  let exportsScene = false;
  ancestor(ast, {
    ImportDeclaration(n) {
      if (!ALLOWED_IMPORTS.has(n.source.value)) problems.push(`can't import ${JSON.stringify(n.source.value)}`);
    },
    ImportExpression() {
      problems.push("not allowed: dynamic import()");
    },
    ExportAllDeclaration() {
      problems.push("not allowed: export * from");
    },
    ExportNamedDeclaration(n) {
      if (n.source) problems.push("not allowed: re-exports");
      for (const s of n.specifiers) if (s.exported.name === "Scene") exportsScene = true;
      for (const d of n.declaration?.declarations ?? []) if (d.id.name === "Scene") exportsScene = true;
      if (n.declaration?.id?.name === "Scene") exportsScene = true;
    },
    ExportDefaultDeclaration() {
      exportsScene = true;
    },
    Identifier(n, _state, ancestors) {
      const parent = ancestors.at(-2);
      const isName =
        (parent?.type === "MemberExpression" && parent.property === n && !parent.computed) ||
        (parent?.type === "Property" && parent.key === n && !parent.computed) ||
        ((parent?.type === "MethodDefinition" || parent?.type === "PropertyDefinition") && parent.key === n) ||
        parent?.type === "ImportSpecifier" ||
        parent?.type === "ExportSpecifier";
      if (!isName && GLOBALS.has(n.name)) problems.push(`not allowed: ${n.name}`);
    },
    MemberExpression(n) {
      if (!n.computed) {
        if (PROPS.has(n.property.name)) problems.push(`not allowed: .${n.property.name}`);
      } else if (n.property.type === "Literal" && typeof n.property.value === "string") {
        if (PROPS.has(n.property.value)) problems.push(`not allowed: [${JSON.stringify(n.property.value)}]`);
      } else if (n.property.type !== "Literal" && hasStringPart(n.property)) {
        problems.push("not allowed: a property name built from strings (write it out, e.g. obj.key)");
      }
    },
    Property(n) {
      const key = n.computed ? null : (n.key.name ?? n.key.value);
      if (KEYS.has(key)) problems.push(`not allowed: ${key}`);
    },
    CallExpression(n) {
      // JSX compiles to jsx("tag", ...): no raw HTML elements that load or run anything.
      const callee = n.callee.type === "Identifier" ? n.callee.name : null;
      const tag = n.arguments[0];
      if (callee && /^_?jsxs?$|^_?jsxDEV$|^jsx$/.test(callee) && tag?.type === "Literal" && TAGS.has(String(tag.value).toLowerCase())) {
        problems.push(`not allowed: <${tag.value}>`);
      }
    },
    NewExpression(n) {
      if (n.callee.type === "Identifier" && GLOBALS.has(n.callee.name)) problems.push(`not allowed: new ${n.callee.name}`);
    },
    Literal(n) {
      if (typeof n.value === "string" && REMOTE.test(n.value)) problems.push("not allowed: a remote URL (use images from props.images)");
    },
    TemplateElement(n) {
      if (REMOTE.test(n.value.cooked ?? "")) problems.push("not allowed: a remote URL (use images from props.images)");
    },
  });
  if (!exportsScene) problems.push("the code must export a component named Scene");
  return problems;
}

/** Compile TSX to CommonJS and return { js } or { error } with every problem found. */
export async function compile(code) {
  if (typeof code !== "string" || !code.trim()) return { error: "No code" };
  if (Buffer.byteLength(code) > MAX_BYTES) return { error: `Code is over ${MAX_BYTES / 1000} KB` };
  let esm;
  try {
    esm = (await transform(code, { loader: "tsx", format: "esm", jsx: "automatic", target: "es2022" })).code;
  } catch (e) {
    const errors = e.errors?.map((x) => `line ${x.location?.line ?? "?"}: ${x.text}`) ?? [String(e.message ?? e)];
    return { error: `Syntax error: ${errors.join("; ")}` };
  }
  // TypeScript drops unused imports, so the source's import lines are checked as written too.
  const problems = [];
  for (const m of code.matchAll(/^\s*import\s[^;]*?from\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm)) {
    const name = m[1] ?? m[2];
    if (!ALLOWED_IMPORTS.has(name)) problems.push(`can't import ${JSON.stringify(name)}`);
  }
  try {
    problems.push(...inspect(esm));
  } catch (e) {
    return { error: `Syntax error: ${e.message}` };
  }
  if (problems.some((p) => p.startsWith("can't import"))) problems.push(`allowed imports: ${[...ALLOWED_IMPORTS].join(", ")}`);
  if (problems.length) return { error: [...new Set(problems)].join("; ") };
  const js = (await transform(code, { loader: "tsx", format: "cjs", jsx: "automatic", target: "es2022" })).code;
  return { js };
}
