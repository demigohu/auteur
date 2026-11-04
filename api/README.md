# Auteur API

FastAPI service that holds the projects, runs the agent, applies timeline edits, renders with ffmpeg and checks the results. Python 3.12, managed with [uv](https://docs.astral.sh/uv/); needs ffmpeg on the PATH and, for videos in code, the Node renderer in `../motion`.

## Run

From the repository root, `make dev` starts the API on `:8000` with the editor on `:3000`. On its own:

```bash
cp .env.example .env        # at least META_API_KEY and CLERK_PUBLISHABLE_KEY
uv sync
uv run uvicorn auteur.main:app --reload --port 8000
```

Interactive API reference: `http://localhost:8000/docs`.

| Variable | Default | |
| --- | --- | --- |
| `META_API_KEY` | | Meta Model API key |
| `META_BASE_URL` | `https://api.meta.ai/v1` | |
| `CLERK_PUBLISHABLE_KEY` | | The editor's Clerk key; the API reads Clerk's signing keys from it |
| `CLERK_JWKS_URL` | | Override where Clerk's signing keys come from |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated |
| `AUTEUR_DATA_DIR` | `data` | Projects, media, renders, voice models |
| `AUTEUR_MOTION_DIR` | `../motion` | The Remotion renderer |
| `MOTION_PARALLEL_RENDERS` | `2` | Scenes rendered at once |
| `MAX_FOOTAGE_SECONDS` | `600` | Footage per project, all videos together |
| `MAX_FILE_SECONDS` | `0` | Per-file limit (`0` = none) |
| `MAX_EXPORT_HEIGHT` | `0` | Largest export, short side in pixels (`0` = none) |
| `USER_SPEND_CAP_USD` | `0` | Meta API spend per account (`0` = no cap) |
| `SPEND_CAP_USD` | `0` | Meta API spend for the whole server |
| `RUNS_PER_VISITOR_PER_DAY` | `0` | Agent runs per visitor per day |

## Layout

```
src/auteur/
├── main.py            HTTP routes, the event stream, background jobs (exports, previews)
├── config.py          settings from the environment
├── auth.py            Clerk session tokens (JWKS)
├── store.py           SQLite: one row per project holding its JSON
├── events.py          per-project event bus behind Server-Sent Events
├── timeline/
│   ├── models.py      the timeline: clips, texts, B-roll, music, effects (Pydantic)
│   ├── ops.py         validated operations, linkage, undo/redo
│   └── history.py     commits and chat messages
├── agent/
│   ├── loop.py        the Muse Spark loop: one tool per turn, then the checker
│   └── tools.py       the 26 tools and the checker (periksa)
├── render.py          timeline → ffmpeg filter graph; exporter.py runs exports in the background
├── effects.py         OpenCV pass for tracked blur and highlight
├── derived.py         reverse, LUTs, sound cleanup, background-removal and chroma previews
├── media.py           ingest, previews, the SAM proxy, probing
├── tracking.py        SAM 3.1 tracking in stitched 5-second segments; reframe.py follows a subject
├── masks.py           SAM 3.1 pixel masks for background removal
├── transcript.py      Voice Transcribe, word timing, silences; transcript_edit.py edits by words
├── watch.py           scene descriptions from sampled frames (Muse Spark)
├── motion.py          videos in code: Muse Wonder storyboard and scenes, rendered by ../motion
├── imagegen.py        Muse Image
├── translate.py       subtitle translation (Muse Spark); tts.py voice-overs and dubbing (MMS-TTS)
├── grade.py, colorist.py, reference.py   color: looks, correction, matching a reference image
├── subtitles.py, textlayer.py            subtitle chunking and the text renderer
├── beats.py, animate.py, freeze.py       beat detection, animations, freeze frames
├── fetch.py           importing from a link, guarded against SSRF
└── costs.py           Meta API prices, so every run shows its cost
```

## Main routes

| Route | |
| --- | --- |
| `GET/POST /projects`, `GET/PATCH/DELETE /projects/{id}` | Projects |
| `POST /projects/{id}/media`, `/media/link`, `/media/generate` | Upload, import a link, generate a picture |
| `POST /projects/{id}/ops`, `/undo`, `/redo` | Timeline edits (the editor and the agent share them) |
| `POST /projects/{id}/runs`, `/runs/stop`, `/runs/{run_id}/undo` | Agent runs |
| `GET /projects/{id}/events` | Server-Sent Events: agent steps, project updates, export progress |
| `POST /projects/{id}/exports`, `/exports/{export_id}/cancel` | Exports |
| `GET /projects/{id}/transcript`, `POST /transcript/run`, `/transcript/cut` | Edit by words |
| `POST /projects/{id}/texts/translate`, `/voiceover`, `/dub` | Languages and voices |
| `POST /projects/{id}/clips/{clip_id}/remove-background`, `/freeze` | Clip tools |
| `PUT /projects/{id}/storyboard`, `POST /scenes/build` | Videos in code |
| `GET /files/...` | Project media and renders (`?download=<name>` saves as an attachment) |

Every project route needs a Clerk session; a project opens only for its owner.

## Tests

```bash
uv run pytest -q
```

The suite renders real (small) videos with ffmpeg and checks pixels, timing and sound, so ffmpeg must be installed. Calls to Meta's models are faked; `scripts/probe_meta.py` and `scripts/probe_sam_tracking.py` exercise the real API, and `scripts/eval_timing.py` measures word timing against a fixture.

After changing `timeline/models.py`, regenerate the editor's types from the repository root with `make types`.
