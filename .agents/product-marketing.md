# Product marketing context: Auteur

Read by the copywriting skill before writing any copy for this project (landing, app UI, emails).

## Product
Auteur is a video editor with an AI agent. You upload clips, write what you want in a sentence, and the
agent watches the footage (Muse Spark), hears every word (Voice Transcribe), tracks people and objects
(SAM 3.1), and builds the edit on a normal timeline you can still change. A checker outside the agent
renders the cut and flags problems before you see it. Built for the Meta AI developer hackathon.

## Audience
Creators who shoot on their phone (vlogs, talking heads, event clips) and would rather not scrub through
footage. Also hackathon judges: technical, design-literate, skeptical of AI demos.

## Positioning
- Headline: "Say the edit. Get the cut."
- Difference from other AI video apps: the output is an editable timeline (four tracks, keyframes, undo
  per instruction), and the agent shows its plan and checks its own work. Most apps hand back a file.

## Proof we can use (measured, sources in the repo)
- 88s of night-walk clips to a 30s vertical vlog in 167 seconds, $0.53 of API calls (E2E run #12)
- 83% subject coverage with SAM 3.1 tracking (up from 53%)
- 86% of words timed within 150ms (up from 37%)
- Cuts within 10ms of the beat; ducking lowers music about 4.6 dB under speech
- Preview vs export color difference 1.4/255; 19 agent tools
- Limits: up to 5 minutes of footage per project

## Claims we can't make yet
- Pricing ("free", "free while in beta"): no pricing decision. [NEED: pricing policy]
- Customers, testimonials, user counts: none. The landing calls its examples "test runs".

## Voice
English, plain and specific, a little playful (handwritten asides, stickers). Film and editing words
(cut, take, reel, render, timeline) over marketing words. No "seamless", "powerful", "unlock".

## Learnings
- 2026-11-03: copy that echoed the design reference (mechay.vercel.app) read as a clone: "We bring
  receipts", "Before you ask", "psst. these stick". Keep our own phrasing.
- 2026-11-03: "You shot 40 minutes" was false (5-minute limit). Check numbers against the product.
