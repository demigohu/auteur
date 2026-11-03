"use client";

import { Plus, Sparkle, X } from "@phosphor-icons/react";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import Image from "next/image";
import { useRef, useState } from "react";
import { Kicker } from "./primitives";

/** Rings that swell with scroll until the dark core fills the screen and the work section begins. */
export function DiveIn() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const scale = useTransform(scrollYProgress, [0, 0.85], [0.35, 7]);
  // As in the reference, the words start low and small and settle in the middle as the rings open.
  const textY = useTransform(scrollYProgress, [0, 0.7], ["30%", "0%"]);
  const textScale = useTransform(scrollYProgress, [0, 0.7], [0.7, 1]);

  return (
    <section ref={ref} className={`relative -mt-px bg-blue ${reduce ? "" : "h-[170vh]"}`} aria-label="Dive in">
      <div className="sticky top-0 grid h-[100dvh] place-items-center overflow-hidden">
        <motion.div style={reduce ? undefined : { scale }} className="relative grid aspect-square w-[min(120vw,120vh)] place-items-center rounded-full border-2 border-ink bg-lime">
          <div className="grid size-[84%] place-items-center rounded-full border-2 border-ink bg-pink">
            <div className="grid size-[82%] place-items-center rounded-full border-2 border-ink bg-paper">
              <div className="mat size-[80%] rounded-full border-2 border-ink" />
            </div>
          </div>
        </motion.div>
        <motion.div style={reduce ? undefined : { y: textY, scale: textScale }} className="absolute inset-0 grid place-items-center text-center text-paper">
          <div>
            <p className="display text-[clamp(90px,19vw,340px)] leading-[0.82] [paint-order:stroke_fill] [-webkit-text-stroke:6px_var(--ink)]">Dive in.</p>
            <p className="mt-2 font-serif text-[clamp(22px,2.6vw,42px)] italic text-paper [paint-order:stroke_fill] [-webkit-text-stroke:4px_var(--ink)]">the cuts are down here</p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

type Cut = { title: string; metric: string; unit: string; tags: string; color: string; ink: string; img: string; note: string; brief: string; did: string[] };

/** Real numbers from Auteur's own runs and test fixtures (docs/PRD.md, "Measured"). */
const CUTS: Cut[] = [
  { title: "Day in my life", metric: "167s", unit: "brief to export", tags: "9:16 · music · beat cuts", color: "#ff4f1f", ink: "#121110", img: "/assets/work-1.jpg", note: "88s of clips, 30s out", brief: "make a 30s day-in-my-life from these clips", did: ["Watched 88 seconds of night-walk clips and put them in time order", "Detected 120 BPM in the lofi track and cut on every bar", "Slowed the best walking shot to 0.5× (shot at 60 fps)", "Crossfades, a slow zoom on the stage, a warm grade", "Checked subject framing and beat sync, then exported 9:16"] },
  { title: "On the beat", metric: "<10ms", unit: "cut to beat", tags: "lofi 120 bpm · every bar", color: "#c8f53c", ink: "#0e3a22", img: "/assets/work-2.jpg", note: "spectral flux + DP beats", brief: "cut this montage to the music", did: ["Beat grid from spectral flux and dynamic programming", "Snapped every cut to the nearest beat", "Checker flags any cut more than 150ms off"] },
  { title: "Blur the crowd", metric: "83%", unit: "subject coverage", tags: "SAM 3.1 · 5s windows", color: "#ff8fcf", ink: "#121110", img: "/assets/work-3.jpg", note: "up from 53%", brief: "blur everyone in the background", did: ["Tracked people with SAM 3.1 in 5-second windows", "Stitched identities across windows by overlap", "Excluded the subject, blurred the rest frame by frame"] },
  { title: "Captions that land", metric: "86%", unit: "words within 150ms", tags: "voice transcribe · karaoke", color: "#ffc22e", ink: "#121110", img: "/assets/work-4.jpg", note: "up from 37%", brief: "add bold subtitles", did: ["Word timing from Voice Transcribe, aligned to the audio envelope", "Removed doubled words from recognizer restarts", "Karaoke highlight in Montserrat, same renderer as export"] },
  { title: "Graded from LOG", metric: "1.4", unit: "/255 preview vs export", tags: "Apple Log · S-Log3 · V-Log", color: "#2e3bff", ink: "#f2eee3", img: "/assets/work-5.jpg", note: "what you see is what ships", brief: "grade this footage, it's S-Log3", did: ["Converted with the maker's LOG curve", "Auto exposure and white balance per clip", "Matched clips to each other, then applied the look"] },
  { title: "Talk over music", metric: "−4.6", unit: "dB ducking under speech", tags: "sidechain · auto", color: "#f2eee3", ink: "#121110", img: "/assets/work-6.jpg", note: "music steps aside", brief: "keep the music but I need to hear myself", did: ["Mapped where speech happens from the transcript", "Sidechain ducking in the export, the same ranges in preview", "Faded the track in and out at the ends"] },
];

const STEP = 360 / CUTS.length;

/** (04) A ring of cards that spins with scroll; the one facing you is the one named below. */
export function Work() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const rotate = useTransform(scrollYProgress, [0, 1], [0, -STEP * (CUTS.length - 1)]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<Cut | null>(null);
  useMotionValueEvent(rotate, "change", (r) => setActive(Math.min(CUTS.length - 1, Math.max(0, Math.round(-r / STEP)))));

  const goTo = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const span = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + (span * i) / (CUTS.length - 1), behavior: "smooth" });
  };

  const cut = CUTS[active];

  return (
    <section id="work" ref={ref} className={`mat relative text-paper ${reduce ? "py-32" : "h-[420vh]"}`}>
      <div className={`${reduce ? "" : "sticky top-0 h-[100dvh]"} overflow-hidden px-[var(--gutter)] pt-28`}>
        <Kicker tone="lime">(04) Selected cuts</Kicker>
        <h2 className="display mt-5 text-[clamp(56px,7vw,112px)]">Cuts we&apos;re</h2>
        <p className="pb-2 font-serif text-[clamp(48px,6vw,96px)] leading-[0.95] italic text-lime">loud about.</p>

        {reduce ? (
          <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {CUTS.map((c) => (
              <button key={c.title} type="button" onClick={() => setOpen(c)} className="text-left">
                <Card cut={c} />
              </button>
            ))}
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-0 grid place-items-center [perspective:1600px]">
            <motion.div style={{ rotateY: rotate, transformStyle: "preserve-3d" }} className="relative h-[300px] w-[min(460px,78vw)] translate-y-10">
              {CUTS.map((c, i) => (
                <button
                  key={c.title}
                  type="button"
                  onClick={() => (i === active ? setOpen(c) : goTo(i))}
                  aria-label={`Show ${c.title}`}
                  className="pointer-events-auto absolute inset-0 transition-[opacity,filter] duration-500 [backface-visibility:hidden]"
                  style={{
                    transform: `rotateY(${i * STEP}deg) translateZ(min(560px, 70vw))`,
                    opacity: i === active ? 1 : 0.45,
                    filter: i === active ? "none" : "saturate(0.6) brightness(0.7)",
                  }}
                >
                  <Card cut={c} />
                </button>
              ))}
            </motion.div>
          </div>
        )}

        {!reduce && (
          <>
            <div className="absolute bottom-8 left-[var(--gutter)] w-48">
              <p className="label text-[10px] text-paper/60">
                {String(active + 1).padStart(2, "0")} / {String(CUTS.length).padStart(2, "0")} · scroll to spin
              </p>
              <div className="mt-2 h-[2px] bg-paper/15">
                <motion.div className="h-full origin-left bg-lime" style={{ scaleX: scrollYProgress }} />
              </div>
            </div>
            <div className="pointer-events-auto absolute bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-paper py-1.5 pr-2 pl-1.5 text-ink">
              <span className="relative size-9 overflow-hidden rounded-full border-2 border-ink" style={{ background: cut.color }}>
                <Image src={cut.img} alt="" fill sizes="36px" className="object-cover mix-blend-multiply" />
              </span>
              <span className="pr-1">
                <span className="block text-[14px] leading-tight font-semibold">{cut.title}</span>
                <span className="block text-[12px] leading-tight text-ink/55">
                  {cut.metric} {cut.unit}
                </span>
              </span>
              <button type="button" onClick={() => setOpen(cut)} aria-label={`Open ${cut.title}`} className="grid size-7 place-items-center rounded-full border border-ink/20 transition-colors hover:bg-ink hover:text-paper">
                <Plus size={12} weight="bold" />
              </button>
            </div>
            <div className="absolute right-[var(--gutter)] bottom-24 hidden size-28 lg:block">
              <svg viewBox="0 0 100 100" className="absolute inset-0 animate-[spin-slow_16s_linear_infinite] text-lime" aria-hidden>
                <circle cx="50" cy="50" r="49" fill="#c8f53c" />
                <defs>
                  <path id="work-badge" d="M50,50 m-35,0 a35,35 0 1,1 70,0 a35,35 0 1,1 -70,0" />
                </defs>
                <text fill="#0e3a22" fontSize="9" letterSpacing="2.4" fontFamily="var(--font-geist-mono)">
                  <textPath href="#work-badge">CLICK A CARD ✺ SEE THE NUMBERS ✺ </textPath>
                </text>
              </svg>
              <Sparkle size={26} weight="fill" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-tomato" />
            </div>
          </>
        )}
      </div>
      <CutDrawer cut={open} onClose={() => setOpen(null)} />
    </section>
  );
}

/** The case behind a card, in a paper drawer from the right (the reference's work aside). */
function CutDrawer({ cut, onClose }: { cut: Cut | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {cut && (
        <>
          <motion.div className="fixed inset-0 z-[130] bg-ink/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            data-lenis-prevent
            role="dialog"
            aria-modal="true"
            aria-label={cut.title}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            className="fixed top-0 right-0 bottom-0 z-[140] w-full max-w-[580px] overflow-y-auto border-l-2 border-ink bg-paper text-ink"
          >
            <div className="flex items-center justify-between border-b-2 border-ink px-7 py-5">
              <span className="label text-[11px] text-ink/60">Selected cut</span>
              <button type="button" onClick={onClose} autoFocus aria-label="Close" className="grid size-10 place-items-center rounded-full border-2 border-ink hover:bg-ink hover:text-paper">
                <X size={16} weight="bold" />
              </button>
            </div>
            <div className="p-7">
              <div className="relative aspect-[16/10] overflow-hidden rounded-[18px] border-2 border-ink" style={{ background: cut.color }}>
                <Image src={cut.img} alt="" fill sizes="580px" className="object-cover mix-blend-multiply" />
                <p className="display absolute bottom-4 left-5 text-[64px] leading-none" style={{ color: cut.ink }}>
                  {cut.metric}
                </p>
              </div>
              <h3 className="display mt-7 text-[56px] leading-[0.9]">{cut.title}</h3>
              <p className="label mt-2 text-[11px] text-ink/60">
                {cut.metric} {cut.unit} · {cut.tags}
              </p>
              <p className="mt-8 font-mono text-[15px]">
                <span className="text-tomato">brief</span> <span className="text-ink/50">{"{{"}</span> {cut.brief} <span className="text-ink/50">{"}}"}</span>
              </p>
              <p className="label mt-8 text-[11px] text-ink/60">What the agent did</p>
              <ol className="mt-3 border-t-2 border-ink">
                {cut.did.map((d, i) => (
                  <li key={d} className="flex gap-4 border-b-2 border-ink py-3.5 text-[15px] leading-snug">
                    <span className="label w-8 shrink-0 pt-0.5 text-[10px] text-ink/50">{String(i + 1).padStart(2, "0")}</span>
                    {d}
                  </li>
                ))}
              </ol>
              <p className="mt-8 font-hand text-[22px] text-ink/70">{cut.note}</p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Card({ cut }: { cut: Cut }) {
  return (
    <div
      className="relative flex h-[300px] w-full flex-col justify-between overflow-hidden rounded-[22px] border-2 border-ink p-6 text-left shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
      style={{ background: cut.color, color: cut.ink }}
    >
      <div className="absolute top-6 right-6 h-[150px] w-[120px] -rotate-6 overflow-hidden rounded-[14px] border-2 border-ink bg-ink">
        <Image src={cut.img} alt="" fill sizes="120px" className="object-cover" />
      </div>
      <div>
        <p className="display max-w-[60%] text-[44px] leading-[0.85]">{cut.title}</p>
        <p className="mt-2 font-hand text-[20px] leading-none opacity-80">{cut.note}</p>
      </div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="display text-[76px] leading-[0.8]">{cut.metric}</p>
          <p className="label mt-2 text-[10px] opacity-75">{cut.unit}</p>
        </div>
        <p className="label text-right text-[9px] opacity-70">{cut.tags}</p>
      </div>
    </div>
  );
}
