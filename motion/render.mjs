// Renders one scene to MP4. Reads a job as JSON on stdin:
//   { code, width, height, fps, durationInFrames, out, images?: {id: dataUrl}, check?: bool }
// Writes JSON lines to stdout: {"progress": 0..1} while rendering, then {"ok": true} or {"ok": false, "error"}.
// With check: true it only validates and compiles (fast; for feedback before a render).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "./validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const say = (o) => process.stdout.write(JSON.stringify(o) + "\n");

/** The host bundle, built once per version of src/ and reused by every render. */
async function serveUrl() {
  const hash = createHash("sha256");
  for (const f of readdirSync(join(here, "src")).sort()) hash.update(f).update(readFileSync(join(here, "src", f)));
  hash.update(readFileSync(join(here, "package.json")));
  const dir = join(here, ".cache", `bundle-${hash.digest("hex").slice(0, 16)}`);
  if (existsSync(join(dir, "index.html"))) return dir;
  const { bundle } = await import("@remotion/bundler");
  const tmp = `${dir}.tmp-${process.pid}`;
  mkdirSync(dirname(dir), { recursive: true });
  await bundle({ entryPoint: join(here, "src", "index.ts"), outDir: tmp });
  try {
    renameSync(tmp, dir);
  } catch {
    rmSync(tmp, { recursive: true, force: true }); // another render finished the same bundle first
  }
  return dir;
}

async function main() {
  const job = JSON.parse(readFileSync(0, "utf8"));
  const compiled = await compile(job.code);
  if (compiled.error) return say({ ok: false, error: compiled.error });
  if (job.check) return say({ ok: true });

  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const url = await serveUrl();
  const inputProps = {
    js: compiled.js, width: job.width, height: job.height, fps: job.fps,
    durationInFrames: job.durationInFrames, images: job.images ?? {},
  };
  try {
    const composition = await selectComposition({ serveUrl: url, id: "Scene", inputProps, logLevel: "error" });
    let last = 0;
    await renderMedia({
      composition, serveUrl: url, codec: "h264", crf: 18, pixelFormat: "yuv420p", outputLocation: job.out,
      inputProps, logLevel: "error", timeoutInMilliseconds: 30_000,
      concurrency: process.env.MOTION_CONCURRENCY ? Number(process.env.MOTION_CONCURRENCY) : null,
      onProgress: ({ progress }) => {
        if (progress - last >= 0.1) {
          last = progress;
          say({ progress: Math.round(progress * 100) / 100 });
        }
      },
    });
  } catch (e) {
    // Remotion wraps the page's error; the first lines are what the scene author needs.
    const message = String(e?.message ?? e).split("\n").slice(0, 6).join("\n");
    return say({ ok: false, error: `Render failed: ${message}` });
  }
  say({ ok: true });
}

if (process.argv[2] === "--bundle") {
  // Prebuild the host bundle (Docker build step), so the first render doesn't pay for it.
  serveUrl().then((d) => console.log(d));
} else {
  main().catch((e) => {
    say({ ok: false, error: String(e?.message ?? e) });
    process.exitCode = 1;
  });
}
