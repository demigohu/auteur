# Auteur Labs

**A video editor you can talk to.** Upload raw footage and direct it like you would a human editor: "make a 30-second vertical cut, open with the best moment, blur everyone's face except hers." An agent built on Meta's models watches and listens to the footage, edits a real timeline you can still change by hand, and checks its own work before handing it over.

Built for the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon), Indie Developer track. Product spec: [docs/PRD.md](docs/PRD.md).

<!-- TODO: demo video link and public demo URL -->

## What makes it different

- **It sees, not just hears.** Transcript-based editors cut on words. Auteur also knows who is on screen, where they are and what happens, so it can follow a subject in a vertical crop or blur every face but one.
- **A timeline, not a black box.** Every agent action is a small, validated edit on the same timeline the editor shows: clips slide into place live, you can trim or move anything yourself, and the agent continues from your changes. Each instruction can be undone as a whole.
- **No footage? It writes the video.** Muse Wonder writes a storyboard, then each scene as a Remotion component; every scene is rendered, checked against frames of its own render and fixed, then lands on the same timeline as clips you can trim, reorder, grade and score. Up to 3 minutes.
- **It checks its own work.** After every render a checker outside the agent's control verifies length, format, that the followed subject stays in frame and that blurred faces don't leak. Problems are marked on the timeline and the agent fixes them on its own.

## How it uses Meta's models

| Model | Role |
| --- | --- |
| **Muse Spark 1.3** | The agent: plans, calls one tool per turn through the Responses API, and reads sampled frames (`watch`) to describe scenes and pick moments |
| **Muse Wonder 1.0** | Videos made in code: writes the storyboard (`storyboard`) and each scene as a Remotion component (`build_scenes`), then looks at frames of its render and fixes clipped or overlapping text |
| **SAM 3.1** (video) | `track`: tracks people, faces, plates... through the footage. Drives subject-following reframes, tracked blur/highlight, and the checker's framing test |
| **Muse Voice Transcribe** | `listen`: what is said, used for subtitles, cutting filler words and long pauses, and choosing moments |

Every run shows its Meta Model API cost live in the editor.

## Agent tools

`plan` · `listen` · `watch` · `track` · `reframe` · `grade` (looks, or match a reference image) · `music` · `cut_on_beat` · `transitions` · `speed` · `zoom` · `cinematic_finish` · `broll` · `effect` (blur / highlight) · `assemble` · `edit_timeline` (any timeline op) · `remove_fillers` · `subtitles` · `storyboard` · `build_scenes` · `render` + automatic checker

## Architecture

```
web/  Next.js 16 editor: Remotion Player preview (from the timeline JSON), timeline,
      agent panel fed by Server-Sent Events, inspector, history
api/  FastAPI: agent loop, timeline op layer + history (SQLite), media ingest,
      SAM tracking, ffmpeg renderer with an OpenCV effects pass, checker
motion/  Remotion renderer for scenes made in code (Node), called by the API per scene
```

Scene code comes from a model that read user text, so it is untrusted and never runs in the editor's browser. The renderer's headless Chromium runs it behind three layers: a parser-based check (only `react`, `remotion` and a few Remotion packages may be imported; no network, storage, globals or code-from-strings), shadowed browser globals with Function constructors disabled, and a Content-Security-Policy that blocks every request off the renderer's own server (`motion/test/`, `api/tests/test_motion.py`).

The timeline is one JSON document described by Pydantic models in `api/src/auteur/timeline/`; the editor's TypeScript types are generated from them (`make types`). The agent's tools and the editor's buttons go through the same op layer, so history, undo and validation behave the same for both.

Engineering notes from testing the Meta Model API (all in [docs/PRD.md](docs/PRD.md)):

- SAM 3.1 gets a 15 fps, 640 px proxy: full-resolution uploads reset the connection.
- SAM's 16 object IDs are per request, not per frame. In a crowded scene they run out on passers-by and the actual subject is never tracked, so footage is tracked in parallel 5-second segments and IDs are stitched across segments by box overlap (subject coverage on the test clip: 53% to 83%).
- Voice Transcribe returns per-turn timing only; word timing is estimated from its streaming partials and cut points are snapped to measured silences.

## Run locally

Needs Node 24+, [uv](https://docs.astral.sh/uv/) and ffmpeg.

```bash
cp api/.env.example api/.env   # set META_API_KEY
make install
make dev                       # editor on :3000, API on :8000
make test                      # API, editor and renderer tests
```

## Deploy (one VPS)

Docker Compose runs the API, the editor and Caddy (automatic HTTPS) on one domain, with the API under `/api` (and on an `api.` subdomain for direct calls). Step by step, with DNS, Clerk production and operations: [docs/DEPLOY.md](docs/DEPLOY.md).

```bash
cp deploy/.env.example .env    # set DOMAIN; point its DNS A record at the server
cp api/.env.example api/.env   # set META_API_KEY and the public-demo guards
docker compose up -d --build
```

For a public demo, set `MAX_FILE_SECONDS=120`, `RUNS_PER_VISITOR_PER_DAY` and `SPEND_CAP_USD` in `api/.env`.

## Built during the hackathon

Everything in this repository was written during the hackathon (Oct 26 to Nov 4, 2026), starting from an empty `create-turbo` scaffold that was removed in the first commit. Third-party pieces are open-source libraries used as dependencies (FastAPI, Next.js, Remotion Player, Motion, OpenCV, ffmpeg, `meta-sam-parser`).
