# DESIGN.md: Auteur Labs

The visual language for the landing page, the sign-in screens, the studio dashboard and the editor. It is extracted from a reference studio site (mechay.vercel.app): we follow its *language and page structure* closely (tokens, type pairing, component shapes, section rhythm, motion), never its content, copy, logos or image files. Our stickers say Auteur things, our numbers are measured, and every image is ours (see "Assets").

**Language: all UI copy is English.** The agent may answer in the user's language, but labels, buttons, errors, history entries and checker marks are English.

**Design read:** a loud, tactile, creator-native studio aesthetic. Neo-brutalist pills with hard shadows, poster-scale condensed type, an italic serif for the human voice, mono labels for the machine voice, stickers you can push around. It suits a product for creators who live in CapCut and Reels, and it makes the agent feel like a collaborator with personality rather than a SaaS dashboard.

Dials: landing `VARIANCE 8 / MOTION 7 / DENSITY 3`; editor `VARIANCE 3 / MOTION 3 / DENSITY 8`.

---

## 1. Tokens

### Color

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#121110` | Text, borders, hard shadows, dark sections |
| `--ink-2` | `#1d1c1a` | Raised dark surfaces (editor stage, timeline) |
| `--ink-3` | `#2a2825` | Dark lines and hover on dark |
| `--paper` | `#f2eee3` | Default light background |
| `--paper-2` | `#e6dfcd` | Recessed light surface, dividers on paper |
| `--lime` | `#c8f53c` | Primary accent: selection, success, "go" |
| `--forest` | `#0e3a22` | Text on lime, mono tag background |
| `--tomato` | `#ff4f1f` | Second display color, playhead, errors, energy |
| `--blue` | `#2e3bff` | Section color, links, the Meta-models section |
| `--pink` | `#ff8fcf` | Primary CTA fill, highlights |
| `--sun` | `#ffc22e` | Sticker/tape color, warnings |

Rules:
- **Color is blocked, not sprinkled.** A section takes one background (paper, lime, blue, ink, tomato) and one display color on top. Never a gradient background.
- On lime: text is `--forest`, never ink gray. On blue and ink: text is `--paper`. On tomato: text is `--ink`.
- In the editor, lime means *selected / passed*, tomato means *playhead / failed*, sun means *warning*, pink means *the primary action* (Export, Send).
- Muted text is ink at 60-70% opacity, not a separate gray.

### Type

| Role | Family | Use |
|---|---|---|
| Display | **Anton** 400 | Headlines, section words, big numbers, sticker words. Always uppercase. `line-height: .86`, `letter-spacing: -.004em` |
| Accent | **Instrument Serif** italic | The human aside in a headline: "*it does the rest.*", "*(and then a check.)*". Only ever italic, only ever a phrase |
| Body / UI | **Inter Tight** 400/500/600 | Paragraphs, buttons (600, `-0.01em`), nav (600, uppercase, 13px) |
| Label | **Geist Mono** 400 | Kicker tags, numbering (`A/01`), technical readouts, timecodes. 11px, uppercase, `letter-spacing: .12em` |
| Note | **Caveat** 600 | Handwritten margin notes with a drawn arrow. At most one or two per screen |

Scale (landing): hero display `clamp(64px, min(12vw, 22vh), 220px)` with slightly jittered letters (`Wobble`, ±2° per glyph); section display `clamp(48px, 8.6vw, 130px)`; body `16-18px / 1.5`; label `11px`.
Scale (editor): UI `13px`, small UI `11-12px`, mono readouts `11px`, panel titles in Anton `18-22px`.

### Shape and depth

- Borders: **2px solid ink** on every interactive surface on paper.
- Radius: pills `999px` (buttons, nav, tags, chips), cards `14px`, stickers `10px`, tiny chips `6px`. Nothing in between.
- Shadow: **hard, offset, no blur**: `0 4px 0 0 var(--ink)` (buttons, nav, cards), `0 2px 0 0` for small chips. Pressed state: translate-y 2px and shadow `0 2px 0 0`.
- No soft drop shadows, no glass, no glows.

### Texture

- Every colored or paper section carries the embossed paper texture: `public/assets/paper-texture.png`, a tileable mid-grey height-lit tile blended with `mix-blend-mode: overlay` (`.paper-texture`, strength via `--texture-strength`, 0.55 default, 0.85 in the hero). Overlay means one tile works on paper, lime, tomato, pink and blue.
- A fixed, `pointer-events: none` film grain over the landing page (3% opacity). Never on scrolling containers.
- The dark editor stage uses a faint 64px grid (ink-3 lines at 40%), like a cutting mat.

### Spacing

`--gutter: clamp(16px, 2.4vw, 40px)` for page edges. Sections `py: clamp(96px, 14vh, 180px)`. Editor panels use a 4px base (8 / 12 / 16 / 24).

---

## 2. Components

**Logo pill.** "AUTEUR" in Anton on lime, 2px ink border, hard shadow, rotated `-4deg` at rest, straightens on hover.

**Nav pill.** Paper fill, 2px border, hard shadow, uppercase Inter Tight 600 13px links with 28px gaps. Centered in the header.

**Primary button (two-part).** A 2px-bordered pill: a square ink cap holding an arrow icon, then the label on pink. Hover: the arrow slides 3px right and the cap swaps to tomato; press: drop 2px.

**Secondary button.** Same shape, paper label segment.

**CTA chip.** Pink pill, 2px border, hard shadow, label + `↗`.

**Mono tag (kicker).** Geist Mono on a 4px-radius chip, `⁞` first, numbered like the reference: `⁞ (02) THE AGENT · INTENT`. Tones: forest/lime, blue/paper, ink/paper, tomato/ink, lime/forest, paper/ink. One per section.

**Sticker.** A small object with a 2px border, hard shadow, slight rotation (-12° to 12°): stamps (starburst SVG, tomato or blue), round badges (lime circle with Anton number), tape labels (sun with a mono line over an Anton word), tag pills (pink/paper with an icon). On the landing, stickers are **draggable** (Motion `drag`, spring back is off; they stay where you drop them) with a Caveat note: "*psst. these stick. go on, drag 'em.*" Hero set: taped card, dotted "Muse Spark" pill, mascot, lime stat circle, blue starburst, polaroid, notched sun ticket, pink heart pill.

**Rotating badge.** Circular text on a path ("SHOOT RAW ✺ SAY CUT ✺ SCROLL ✺") in lime on ink, spinning slowly around an arrow.

**Ribbon marquee.** Two long tapes (tomato and lime, 2px ink borders) crossing at opposite small angles over a section boundary, Anton words separated by `✺`, scrolling in opposite directions. One ribbon pair per page.

**Numbered list row.** Mono index (`A/01`) left, Anton title, one line of Inter Tight under it, 2px ink rule between rows.

**Card (editor).** Paper, 2px ink border, 14px radius, hard shadow only when it floats (popovers, chat cards), flat inside panels.

**Forms.** Underlined fields with a mono label above (2px rule, ink on focus, tomato with a message on error), a show/hide toggle on passwords, pill chips for choices (ink fill + lime text when chosen), the two-part pink submit pill, and a Caveat aside next to it ("*no spam, pinky promise.*"). Validation runs on submit and shows inline; server errors show as a sun-yellow note.

**Dialog.** Paper card, 2px ink border, 22px radius, hard offset shadow (ink, or tomato for destructive), Anton title, backdrop `ink/60` with a light blur. Escape and backdrop click close it; destructive dialogs focus the safe button.

**Rainbow arcs.** Concentric quarter-circle bands (blue, lime, sun, pink, tomato) from a corner, behind forms on ink.

**Pull tag.** A luggage tag on a string at the header's right. It sways on a loop; pull it down past 90px and it drops away to sign-up.

---

## 3. Motion

Easing: `--ease-out: cubic-bezier(.16, 1, .3, 1)` for everything that settles; `--ease-back: cubic-bezier(.34, 1.56, .64, 1)` for stickers and pops.

| Pattern | Tool | Why |
|---|---|---|
| Hero lines rise in, stickers pop with a back ease and settle at their rotation | Motion | First impression; establishes the playful tone |
| Draggable stickers | Motion `drag` | The page invites touching, like the product invites editing |
| Ribbon marquees | CSS keyframes (transform only) | Constant energy, zero JS |
| Word-by-word scrub reveal of a long statement | GSAP ScrollTrigger `scrub` | Reads at the user's pace; the key number gets the highlight box |
| Intro gate: mascot, 0-100 counter, "enter with sound / enter quietly" | Motion `animate` + clip-path exit | Once per session (sessionStorage); the hero waits for it |
| Ring cursor (ring + dot, swells on links) | Motion springs | Fine pointers only, off under reduced motion |
| Opt-in sound (pop on sticker drag, tick on nav, whoosh on enter) | Web Audio, synthesized | No files needed; the floating speaker button toggles it |
| Pinned horizontal "WATCH · LISTEN · CUT." with props between | GSAP pin + horizontal pan; fillers struck via `containerAnimation` | The whole job, one word at a time |
| "Dive in" rings swelling into the dark work section | Motion `useScroll` scale | The page changes register from loud to showcase |
| 3D ring of work cards that spins with scroll | Motion `useScroll` → `rotateY` on a `preserve-3d` cylinder | The facing card is named in a pill below; clicking a card scrolls to it |
| Receipt printing out of a slot | Motion `whileInView` on the slot, variants on the paper | Triggers on the unclipped wrapper (an observer can't see the hidden paper) |
| Stacked process cards | CSS `position: sticky` with stepped `top` | Five steps pile up like a deck |
| Editor | Motion only, short (150-250ms), state transitions only | A tool, not a show |

Everything above `MOTION 3` collapses under `prefers-reduced-motion`: no pin, no scrub, no marquee movement, stickers static.

---

## 4. Page map

Landing (`/`), section by section, mirroring the reference's order:

| # | Section | Surface | Reference counterpart |
|---|---|---|---|
| 0 | Intro gate | ink mat | preloader with mascot and counter |
| 1 | Hero: typewriter brief, "SHOOT RAW. / JUST SAY CUT.", stickers, lime hill, crossing tapes | paper | hero |
| 2 | "You shot [40 minutes]…" scrub statement with a drawn squiggle | lime | "you've got about 1.7 seconds" |
| 3 | WATCH [phone] LISTEN [transcript] CUT. (and then a check.) | lime, pinned | "STOP THE SCROLL" |
| 4 | Stack tape (Muse Spark, SAM 3.1, FFmpeg…) in mixed type | sun tape | client-logo tape |
| 5 | (02) The agent: "TELL IT ONCE. / it does the rest." + plan card + A/01 list | paper | Google ads |
| 6 | (03) The editor: "EVERY CUT / stays yours." + phone mock + E/01 list | blue | Meta ads |
| 7 | Dive in | sun → ink | dive in |
| 8 | (04) Selected cuts: 3D card ring with measured numbers | ink mat | selected work |
| 9 | (05) The receipts: stats + printed receipt | tomato | the receipts |
| 10 | (06) The full toolkit: vertical title + colored accordion rows | ink | beyond the ads |
| 11 | (07) How it works: five stacked cards | paper | how we work |
| 12 | (08) From the agent: its real closing message, handwritten | pink | client love |
| 13 | (09) FAQ, two columns, nothing collapsed | paper | before you ask |
| 14 | (10) Say hi: the sign-up form itself, rainbow arcs, mascot | ink mat | contact form |
| 15 | Footer with a full-width lime wordmark | ink mat | footer |

App surfaces:

- **Sign in / Create account (`/login`, `/signup`).** The "say hi" layout: ink mat, rainbow arcs, big headline with a serif aside, a mascot you can poke, and Clerk's `<SignIn>` / `<SignUp>` on the right, dressed in paper, ink and lime by `components/auth/appearance.ts`.
- **Studio (`/studio`).** A video-editor home screen: sidebar (logo, New project, Home / Projects / Recipes, account card with sign out), search (`/` or ⌘K), "Pick a format" tiles (16:9, 9:16, 1:1, drop footage), recent projects as thumbnail cards (aspect badge, duration, rename/delete menu), and recipes (colored brief cards). Dropping files anywhere starts a project in the clips' own orientation. New project is a dialog: name, format, frame rate, footage, first brief for the agent.
- **404.** Mascot, "CUT." in tomato, "*this scene never made the edit.*"

---

## 5. Applying it to the app (studio and editor)

The studio and the editor have a **Day / Night** toggle (`components/ui/ThemeToggle.tsx`, stored per browser by
`lib/theme.ts`, night by default). The landing and sign-in pages keep their single designed look.

- **Night** (`.theme-night` on the root): every panel dark and neutral (`#1a1917`), cards a step lighter, the
  preview stage and timeline darker still (`.theme-ink`). Best for judging color.
- **Day**: everything on paper, including the timeline; the preview stage is a neutral light grey.
- **Tokens, not colors.** Components use semantic tokens that both themes define: `bg`/`panel`/`panel-2`/`raised`,
  `text`/`muted`/`faint`, `line`/`line-strong`, `edge` (outlines and dividers), `card` and `card-text`,
  `edge-shadow`, `stage`/`stage-grid`, `accent`. Selected chips invert (`bg-text text-bg`). Hard-coded ink and
  paper stay only on accent chips (lime, pink, sun keep an ink outline and ink text) and on labels over footage.
- **Accent flips with the theme**: tomato on paper, lime on dark. Failures are tomato, warnings sun, Export and
  Send pink.
- **Sliders are neutral** (thin line, round thumb in the text color): no colored fill next to footage.
- **Agent panel.** User messages are cards; the plan is a numbered list with mono indices; tool rows use mono;
  checker results are lime (pass) or tomato (fail) stamps.
- **Inspector.** Section titles in Anton; segmented controls are pills.

## 6. Assets

Source art lives in `web/assets-src/` (not committed: large PNGs). `web/scripts/prepare_assets.py` cuts the
white backgrounds off stickers and the logo, makes the paper texture seamless, resizes everything and
writes WebP to `web/public/assets/`, plus `src/app/icon.png`, `apple-icon.png` and `opengraph-image.png`.
Re-run it after replacing any source file.

| Served file | Use |
|---|---|
| `logo.png` | Wordmark in the header, studio, editor and auth (`components/ui/Logo.tsx`) |
| `paper-texture.png` | Seamless grey tile under `.paper-texture` (overlay blend) |
| `mascot.webp`, `mascot-wink.webp`, `mascot-wow.webp` | Leader, hero sticker, sign-up (wink on poke), sign-in, 404 |
| `hero-1..3.webp` | The monitor tile in the headline, hard-cutting every 1.6s |
| `polaroid.webp` | Hero polaroid sticker |
| `sticker-clapper.webp`, `sticker-rec.webp`, `sticker-reel.webp` | Hero stickers |
| `work-1..6.webp` | Test-run cards and their drawer |
| `sfx/*.mp3` | pop (sticker drag), tick (hover), beep + clap (enter with sound), projector |

## 7. Identity moments (ours, not the reference's)

The reference supplies the visual language; these moments are Auteur's own and should stay editing-themed:
film-leader countdown with a shutter exit; playhead cursor with a scroll timecode (CUT on links, GRAB on
stickers); REC badge with a running clock in the header; a monitor tile in the headline; film-strip ribbons
with moving sprocket holes; an export bar that fills with the manifesto; "test runs" and a "render log"
instead of client work and receipts.

**Copy** follows the copywriting skill and `.agents/product-marketing.md` (proof points, claims we can't
make yet, voice).

## 8. Don'ts

- No purple, no gradients behind text, no glassmorphism, no soft shadows.
- No em dashes in UI copy.
- One crossing tape pair per page (the hero); Caveat notes only beside the thing they point at.
- Don't put stickers in the editor; personality there comes from type, color and the agent's voice.
- Don't invent numbers. Landing stats come from measured runs (see docs/PRD.md and the test scripts).
