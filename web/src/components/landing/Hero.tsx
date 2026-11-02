"use client";

import { ArrowDown, Heart } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useExperience } from "./experience";
import { Note, PillButton, RotatingBadge, Starburst } from "./primitives";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE_BACK = [0.34, 1.56, 0.64, 1] as const;

const BRIEFS = ["make a 30s vlog", "cut the ums", "reframe it to 9:16", "grade it warm", "blur the plates", "sync it to the beat"];

/** Display line whose letters sit slightly off-grid, like hand-set wood type. */
export function Wobble({ text, seed }: { text: string; seed: number }) {
  return (
    <>
      {[...text].map((ch, i) => {
        const r = Math.sin((i + 1) * 12.9898 * seed) * 43758.5453;
        const f = r - Math.floor(r);
        return (
          <span key={i} className="inline-block" style={{ transform: `rotate(${((f - 0.5) * 4).toFixed(2)}deg) translateY(${((f - 0.5) * 0.04).toFixed(3)}em)` }}>
            {ch === " " ? " " : ch}
          </span>
        );
      })}
    </>
  );
}

function Typewriter() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const word = BRIEFS[i];

  useEffect(() => {
    if (reduce) return;
    const done = !deleting && n === word.length;
    const empty = deleting && n === 0;
    const t = setTimeout(
      () => {
        if (done) setDeleting(true);
        else if (empty) {
          setDeleting(false);
          setI((i + 1) % BRIEFS.length);
        } else setN(n + (deleting ? -1 : 1));
      },
      done ? 1600 : empty ? 300 : deleting ? 35 : 70,
    );
    return () => clearTimeout(t);
  }, [n, deleting, word, i, reduce]);

  return (
    <p className="font-mono text-[clamp(17px,1.7vw,24px)] text-ink">
      <span className="text-tomato">brief</span> <span className="text-ink/45">{"{{"}</span> <span aria-hidden>{reduce ? BRIEFS[0] : word.slice(0, n)}</span>
      <span className="sr-only">{BRIEFS.join(", ")}</span>
      <span aria-hidden className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.15em] animate-pulse bg-ink" />
      <span className="text-ink/45"> {"}}"}</span>
    </p>
  );
}

/** Draggable sticker: pops in at its resting tilt and stays where it is dropped. */
function Sticker(props: { children: React.ReactNode; className: string; rotate: number; delay: number; bounds: React.RefObject<HTMLElement | null> }) {
  const reduce = useReducedMotion();
  const { entered, play } = useExperience();
  return (
    <motion.div
      data-cursor
      drag={!reduce}
      dragConstraints={props.bounds}
      dragMomentum={false}
      onDragStart={() => play("pop")}
      whileHover={reduce ? undefined : { scale: 1.05, rotate: props.rotate * 0.6 }}
      whileDrag={{ scale: 1.1, rotate: props.rotate * 0.3, cursor: "grabbing", zIndex: 40 }}
      initial={reduce ? false : { opacity: 0, scale: 0.3, rotate: props.rotate - 25 }}
      animate={entered ? { opacity: 1, scale: 1, rotate: props.rotate } : undefined}
      transition={{ delay: props.delay, duration: 0.7, ease: EASE_BACK }}
      className={`absolute z-20 cursor-grab touch-none select-none ${props.className}`}
    >
      {props.children}
    </motion.div>
  );
}

export function Hero() {
  const reduce = useReducedMotion();
  const { entered } = useExperience();
  const ref = useRef<HTMLElement>(null);
  const line = (i: number) =>
    reduce ? {} : { initial: { y: "110%" }, animate: entered ? { y: 0 } : undefined, transition: { delay: 0.1 + i * 0.14, duration: 1, ease: EASE_OUT } };
  const fade = (d: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 18 }, animate: entered ? { opacity: 1, y: 0 } : undefined, transition: { delay: d, duration: 0.9, ease: EASE_OUT } };

  return (
    <section ref={ref} className="paper-texture relative h-[100dvh] min-h-[780px] overflow-hidden bg-paper px-[var(--gutter)] pt-32 [--texture-strength:0.85]">
      <motion.div {...fade(0.05)}>
        <Typewriter />
      </motion.div>

      <h1 className="display mt-1 text-[clamp(64px,min(12vw,22vh),220px)] leading-[0.84] text-ink">
        <span className="block overflow-hidden md:pl-[14vw]">
          <motion.span className="block" {...line(0)}>
            <Wobble text="Shoot raw." seed={3} />
          </motion.span>
        </span>
        <span className="block overflow-hidden pb-[0.05em] text-tomato md:text-right">
          <motion.span className="block" {...line(1)}>
            <Wobble text="Just say cut." seed={7} />
          </motion.span>
        </span>
      </h1>

      <div className="relative z-10 mt-8 max-w-[34rem]">
        <motion.p {...fade(0.45)} className="text-[clamp(17px,1.45vw,21px)] leading-[1.42] text-ink">
          Auteur is a video editor for <strong className="font-semibold">raw footage</strong> and{" "}
          <strong className="font-semibold">people who&apos;d rather not scrub</strong>. Say what you want. It watches, listens, cuts, and checks its own work.
        </motion.p>
        <motion.div {...fade(0.6)} className="mt-8 flex flex-wrap gap-3">
          <PillButton href="/signup">Start editing</PillButton>
          <PillButton href="#work" tone="paper">
            See it work
          </PillButton>
        </motion.div>
      </div>

      {/* Stickers: facts about Auteur, all of them draggable. */}
      <Sticker bounds={ref} rotate={-16} delay={0.5} className="top-[30%] left-[2.5%] hidden md:block">
        <div className="relative">
          <span className="absolute -top-3 left-1/2 z-10 h-7 w-20 -translate-x-1/2 rotate-[-8deg] bg-[#e9dfc4]/85 shadow-sm" />
          <div className="hard grid h-[132px] w-[150px] place-items-center rounded-[12px] bg-tomato">
            <p className="display text-center text-[44px] leading-[0.82] text-ink">
              Zero
              <br />
              scrub
            </p>
          </div>
        </div>
      </Sticker>

      <Sticker bounds={ref} rotate={8} delay={0.6} className="top-[11%] left-[32%] hidden lg:block">
        <span className="hard inline-flex items-center gap-2 rounded-full bg-paper px-4 py-2 text-[15px] font-semibold text-ink">
          <span className="flex gap-1">
            {["#2e3bff", "#ff4f1f", "#ffc22e", "#c8f53c"].map((c) => (
              <span key={c} className="size-2.5 rounded-full" style={{ background: c }} />
            ))}
          </span>
          Muse Spark
        </span>
      </Sticker>

      <Sticker bounds={ref} rotate={-4} delay={0.7} className="top-[7%] left-[49%] hidden lg:block">
        <motion.div animate={reduce ? undefined : { y: [0, -8, 0], rotate: [0, 6, -4, 0] }} transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}>
          <Image src="/assets/mascot.png" alt="" width={96} height={96} className="drop-shadow-[0_8px_10px_rgba(0,0,0,0.25)]" draggable={false} />
        </motion.div>
      </Sticker>

      <Sticker bounds={ref} rotate={-10} delay={0.8} className="top-[18%] right-[8%] hidden md:block">
        <div className="hard grid size-[150px] place-items-center rounded-full bg-lime text-forest">
          <div className="text-center">
            <p className="label text-[10px]">Subjects tracked</p>
            <p className="display text-[56px]">83%</p>
          </div>
        </div>
      </Sticker>

      <Sticker bounds={ref} rotate={-14} delay={0.9} className="top-[56%] left-[44%] hidden lg:block">
        <Starburst color="#2e3bff" className="size-36">
          <p className="label text-[9px] text-paper">Fillers</p>
          <p className="display text-[40px] text-paper">-eee</p>
        </Starburst>
      </Sticker>

      <Sticker bounds={ref} rotate={-6} delay={1} className="top-[50%] right-[15%] hidden md:block">
        <div className="hard w-[180px] rounded-[4px] bg-paper p-2.5 pb-3">
          <div className="relative overflow-hidden rounded-[2px] border-2 border-ink">
            <Image src="/assets/polaroid.jpg" alt="A graded night shot" width={300} height={300} className="aspect-square object-cover" draggable={false} />
            <span className="display absolute top-2 left-2 text-[34px] leading-[0.85] text-paper drop-shadow">
              Take
              <br />
              07
            </span>
            <span className="label absolute bottom-2 left-2 rounded-[3px] bg-ink px-1.5 py-0.5 text-[9px] text-lime">Auto-graded</span>
          </div>
          <p className="mt-2 text-center font-hand text-[19px] leading-none text-ink">night walk, warm grade</p>
        </div>
      </Sticker>

      <Sticker bounds={ref} rotate={4} delay={1.1} className="right-[31%] bottom-[24%] hidden md:block">
        <div className="bg-sun px-5 py-2 text-ink [clip-path:polygon(0_0,100%_0,100%_35%,96%_50%,100%_65%,100%_100%,0_100%,0_65%,4%_50%,0_35%)]">
          <p className="label text-[9px]">Certified</p>
          <p className="display text-[30px]">beat-synced</p>
        </div>
      </Sticker>

      <Sticker bounds={ref} rotate={-9} delay={1.2} className="bottom-[21%] left-[36%] hidden lg:block">
        <span className="hard inline-flex items-center gap-2 rounded-full bg-pink px-4 py-2 text-[15px] font-semibold text-ink">
          <Heart size={14} weight="fill" className="text-tomato" /> Reels-ready
        </span>
      </Sticker>

      <motion.div {...fade(1.3)} className="absolute top-[13%] right-[21%] hidden xl:block">
        <Note arrow="right">psst. these stick. go on, drag &apos;em.</Note>
      </motion.div>

      <div className="absolute right-[var(--gutter)] bottom-[27%] z-10 hidden md:block">
        <RotatingBadge text="shoot raw ✺ say cut ✺ scroll ✺ " className="size-36" tone="lime">
          <ArrowDown size={24} weight="bold" />
        </RotatingBadge>
      </div>

      {/* The lime hill the next section grows out of, with the crossing tapes over it. */}
      <div aria-hidden className="pointer-events-none absolute -bottom-[130px] left-1/2 h-[300px] w-[150vw] -translate-x-1/2 rounded-[50%] bg-lime" />
      <Tapes />
    </section>
  );
}

const TAPE_A = ["Shoot raw", "Just say cut", "Watch", "Listen", "Track", "Reframe", "Grade"];
const TAPE_B = ["Scroll-stopping cuts", "Beat-synced", "Subtitles that land", "Checked before export"];

function Tape({ words, color, className, speed, reverse }: { words: string[]; color: string; className: string; speed: number; reverse?: boolean }) {
  const row = (
    <div className="flex shrink-0 items-center">
      {words.map((w) => (
        <span key={w} className="display flex items-center gap-6 px-6 text-[clamp(30px,3.4vw,52px)] whitespace-nowrap text-ink">
          {w} <span className="text-[0.6em]">✺</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className={`absolute left-[-10%] w-[120%] overflow-hidden border-y-2 border-ink py-1.5 ${className}`} style={{ backgroundColor: color }}>
      <div className="flex w-max motion-safe:animate-[marquee_linear_infinite]" style={{ animationDuration: `${speed}s`, animationDirection: reverse ? "reverse" : "normal" }}>
        {row}
        {row}
        {row}
        {row}
      </div>
    </div>
  );
}

function Tapes() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-[220px]">
      <Tape words={TAPE_A} color="#ff4f1f" className="bottom-[78px] -rotate-[5deg]" speed={46} />
      <Tape words={TAPE_B} color="#c8f53c" className="bottom-[10px] rotate-[2.5deg]" speed={38} reverse />
    </div>
  );
}
