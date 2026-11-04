# Auteur web

The editor and the landing page: Next.js 16 (App Router), React, TypeScript, Tailwind, Zustand for state, Remotion Player for the preview, Clerk for accounts. It talks to the API in `../api` over REST and Server-Sent Events.

## Run

From the repository root, `make dev` starts this app on `:3000` with the API on `:8000`. On its own:

```bash
cp .env.example .env.local
npm install
npm run dev
```

| Variable | |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (`pk_test_…` locally) |
| `CLERK_SECRET_KEY` | Clerk secret key, server side only |
| `NEXT_PUBLIC_API_URL` | The API, if not `http://localhost:8000` (in production `https://<domain>/api`, baked in at build time) |

| Script | |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server (standalone output, used by the Dockerfile) |
| `npm test` | Vitest |
| `npm run lint` | ESLint |
| `npm run types` | Regenerate `src/lib/timeline.ts` from `timeline.schema.json` (`make types` at the root does both steps) |

## Layout

```
src/
├── app/              routes: / (landing), /login, /signup, /studio, /p/[id] (editor),
│                     /p/[id]/upload (phone upload), /privacy, /terms
├── proxy.ts          Clerk middleware: /studio and /p/* need an account
├── components/
│   ├── editor/       the editor: TopBar, MediaBin, Preview, CanvasTransform, TimelinePanel,
│   │                 SidePanel tabs (Agent, Story, Words, Inspector, History), ExportMenu
│   ├── landing/      the landing page sections
│   ├── studio/       project list and the new-project dialog
│   ├── auth/         sign-in and sign-up screens
│   └── legal/        privacy and terms
├── remotion/         TimelineComposition: draws the timeline JSON for Remotion Player
└── lib/
    ├── store.ts      Zustand store: project, selection, playhead, agent run, actions
    ├── api.ts        typed API client
    ├── timeline.ts   types generated from the API's Pydantic models (don't edit by hand)
    └── *.ts          the preview's halves of rules the export also implements
```

## Preview and export match

The preview is Remotion Player drawing the timeline JSON in the browser; the export is ffmpeg on the server. Rules that exist in both are written twice and tested against each other: crop windows (`lib/crop.ts`), transforms (`transform.ts`), keyframes and animations (`keys.ts`, `animate.ts`), transitions (`transitions.ts`), color (`grade.ts`), overlays (`overlay.ts`) and text (`remotion/TextLayer.tsx`). When you change one side, change its counterpart in `api/src/auteur/` and its parity test.

Heavy previews (reversed clips, LUTs, cleaned sound, removed backgrounds, chroma key) are prepared by the API in the background; until they are ready the preview shows the plain clip with a "Preparing … preview" label.

## Editing the timeline

Every change goes through `applyOps` in the store, which sends validated operations to the API (`POST /projects/{id}/ops`). The agent uses the same operations, so history and undo cover both. While an agent run is active the timeline is locked; its events arrive over `GET /projects/{id}/events` and update the store live.
