"use client";

import { Plus, Sparkle } from "@phosphor-icons/react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import Image from "next/image";
import { useRef, useState } from "react";
import { Kicker } from "./primitives";

/** Rings that swell with scroll until the dark core fills the screen and the work section begins. */
export function DiveIn() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const scale = useTransform(scrollYProgress, [0, 0.85], [0.55, 7]);
  const text = useTransform(scrollYProgress, [0, 0.6, 0.85], [1, 1.15, 0.9]);
  const fade = useTransform(scrollYProgress, [0.7, 0.9], [1, 0]);

  return (
    <section ref={ref} className={`relative bg-sun ${reduce ? "" : "h-[220vh]"}`} aria-label="Dive in">
      <div className="sticky top-0 grid h-[100dvh] place-items-center overflow-hidden">
        <motion.div style={reduce ? undefined : { scale }} className="relative grid aspect-square w-[min(120vw,120vh)] place-items-center rounded-full border-2 border-ink bg-lime">
          <div className="grid size-[84%] place-items-center rounded-full border-2 border-ink bg-pink">
            <div className="grid size-[82%] place-items-center rounded-full border-2 border-ink bg-paper">
              <div className="mat size-[80%] rounded-full border-2 border-ink" />
            </div>
          </div>
        </motion.div>
        <motion.div style={reduce ? undefined : { scale: text, opacity: fade }} className="absolute text-center text-paper">
          <p className="display text-[clamp(90px,15vw,240px)]">Dive in.</p>
          <p className="font-serif text-[clamp(28px,3vw,44px)] italic text-paper/85">the cuts are down here</p>
        </motion.div>
      </div>
    </section>
  );
}

type Cut = { title: string; metric: string; unit: string; tags: string; color: string; ink: string; img: string; note: string };

/** Real numbers from Auteur's own runs and test fixtures (docs/PRD.md, "Measured"). */
const CUTS: Cut[] = [
  { title: "Day in my life", metric: "167s", unit: "brief to export", tags: "9:16 · music · beat cuts", color: "#ff4f1f", ink: "#121110", img: "/assets/work-1.jpg", note: "88s of clips, 30s out" },
  { title: "On the beat", metric: "<10ms", unit: "cut to beat", tags: "lofi 120 bpm · every bar", color: "#c8f53c", ink: "#0e3a22", img: "/assets/work-2.jpg", note: "spectral flux + DP beats" },
  { title: "Blur the crowd", metric: "83%", unit: "subject coverage", tags: "SAM 3.1 · 5s windows", color: "#ff8fcf", ink: "#121110", img: "/assets/work-3.jpg", note: "up from 53%" },
  { title: "Captions that land", metric: "86%", unit: "words within 150ms", tags: "voice transcribe · karaoke", color: "#ffc22e", ink: "#121110", img: "/assets/work-4.jpg", note: "up from 37%" },
  { title: "Graded from LOG", metric: "1.4", unit: "/255 preview vs export", tags: "Apple Log · S-Log3 · V-Log", color: "#2e3bff", ink: "#f2eee3", img: "/assets/work-5.jpg", note: "what you see is what ships" },
  { title: "Talk over music", metric: "−4.6", unit: "dB ducking under speech", tags: "sidechain · auto", color: "#f2eee3", ink: "#121110", img: "/assets/work-6.jpg", note: "music steps aside" },
];

const STEP = 360 / CUTS.length;

/** (04) A ring of cards that spins with scroll; the one facing you is the one named below. */
export function Work() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const rotate = useTransform(scrollYProgress, [0, 1], [0, -STEP * (CUTS.length - 1)]);
  const [active, setActive] = useState(0);
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
              <Card key={c.title} cut={c} />
            ))}
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-0 grid place-items-center [perspective:1600px]">
            <motion.div style={{ rotateY: rotate, transformStyle: "preserve-3d" }} className="relative h-[300px] w-[min(460px,78vw)] translate-y-10">
              {CUTS.map((c, i) => (
                <button
                  key={c.title}
                  type="button"
                  onClick={() => goTo(i)}
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
            <div className="absolute bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-paper py-1.5 pr-2 pl-1.5 text-ink">
              <span className="relative size-9 overflow-hidden rounded-full border-2 border-ink" style={{ background: cut.color }}>
                <Image src={cut.img} alt="" fill sizes="36px" className="object-cover mix-blend-multiply" />
              </span>
              <span className="pr-1">
                <span className="block text-[14px] leading-tight font-semibold">{cut.title}</span>
                <span className="block text-[12px] leading-tight text-ink/55">
                  {cut.metric} {cut.unit}
                </span>
              </span>
              <span className="grid size-7 place-items-center rounded-full border border-ink/20">
                <Plus size={12} weight="bold" />
              </span>
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
    </section>
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
