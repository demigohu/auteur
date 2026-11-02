"use client";

import { ArrowDown, Heart } from "@phosphor-icons/react";
import { gsap } from "gsap";
import { type MotionValue, motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useExperience } from "./experience";
import { PillButton, RotatingBadge, Starburst } from "./primitives";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE_BACK = [0.34, 1.56, 0.64, 1] as const;

const BRIEFS = ["make a 30s vlog", "cut the ums", "reframe it to 9:16", "grade it warm", "blur the plates", "sync it to the beat"];

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
    <>
      <span className="font-semibold text-tomato">brief</span> <span className="text-ink/50">{"{{ "}</span>
      <span aria-hidden>{reduce ? BRIEFS[0] : word.slice(0, n)}</span>
      <span aria-hidden className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.12em] animate-[pulse_1s_steps(1)_infinite] bg-current" />
      <span className="sr-only">{BRIEFS.join(", ")}</span>
      <span className="text-ink/50">{" }}"}</span>
    </>
  );
}

/**
 * One headline word, each letter in its own clipping mask so it can rise into place. `shaky` letters
 * never settle: they jitter like a handheld camera, the way the reference's "noise." does.
 */
function Word({ text, start, shaky }: { text: string; start: number; shaky?: boolean }) {
  const reduce = useReducedMotion();
  const { entered } = useExperience();
  const jitter = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!shaky || reduce || !entered || !jitter.current) return;
    const chars = jitter.current.querySelectorAll("[data-jit]");
    const tween = gsap.to(chars, {
      y: "random(-5, 5)",
      rotation: "random(-4, 4)",
      duration: 0.14,
      ease: "none",
      repeat: -1,
      repeatRefresh: true,
      delay: 1.4,
    });
    return () => {
      tween.kill();
    };
  }, [shaky, reduce, entered]);

  return (
    <span ref={jitter} className="inline-block whitespace-nowrap" aria-hidden>
      {[...text].map((ch, i) => (
        <span key={i} className="relative inline-block overflow-clip pb-[0.02em]">
          <motion.span
            className="relative inline-block"
            initial={reduce ? false : { y: "110%", rotate: 8 }}
            animate={entered ? { y: "0%", rotate: 0 } : undefined}
            transition={{ delay: start + i * 0.035, duration: 0.9, ease: EASE_OUT }}
          >
            <span data-jit className="inline-block">
              {ch}
            </span>
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/** The card set into the first headline line, cycling through three facts (CSS `tile` keyframes). */
function Tile() {
  const reduce = useReducedMotion();
  const { entered } = useExperience();
  const slides = [
    { text: "9:16\nauto", bg: "var(--blue)", fg: "var(--paper)" },
    { text: "-eee", bg: "var(--lime)", fg: "var(--forest)" },
    { text: "zero\nscrub", bg: "var(--tomato)", fg: "var(--ink)" },
  ];
  return (
    <motion.span
      className="relative inline-block h-[0.74em] w-[0.92em] shrink-0 align-middle"
      initial={reduce ? false : { scale: 0, rotate: -30 }}
      animate={entered ? { scale: 1, rotate: -4 } : undefined}
      transition={{ delay: 0.05, duration: 0.8, ease: EASE_BACK }}
      style={{ rotate: -4 }}
      aria-hidden
    >
      <span className="absolute inset-0 overflow-hidden rounded-[0.1em] border-[3px] border-ink">
        {slides.map((s, i) => (
          <span
            key={s.text}
            className="tile-slide absolute inset-0 flex items-center justify-center text-center text-[0.2em] leading-[0.9] whitespace-pre-line"
            style={{ background: s.bg, color: s.fg, animationDelay: `${i * 2}s` }}
          >
            {s.text}
          </span>
        ))}
        <span className="absolute right-[0.06em] bottom-[0.05em] text-tomato">
          <Heart weight="fill" className="beat size-[0.13em]" />
        </span>
      </span>
      <span className="absolute -top-[0.06em] left-1/2 h-[0.12em] w-[0.42em] -translate-x-1/2 rotate-[-6deg] bg-[#e8dcc0]/90 shadow-sm" />
    </motion.span>
  );
}

/**
 * Draggable sticker with scroll parallax (moves up at `speed` × 0.2 of the scroll, as in the
 * reference) and a pop-in after the headline lands.
 */
function Sticker(props: {
  children: React.ReactNode;
  className: string;
  rotate: number;
  speed: number;
  delay: number;
  scrollY: MotionValue<number>;
  bounds: React.RefObject<HTMLElement | null>;
}) {
  const reduce = useReducedMotion();
  const { entered, play } = useExperience();
  const y = useTransform(props.scrollY, (v) => -v * props.speed * 0.2);
  return (
    <motion.div className={`absolute z-20 ${props.className}`} style={reduce ? undefined : { y }}>
      <motion.div
        data-cursor="drag"
        drag={!reduce}
        dragConstraints={props.bounds}
        dragMomentum={false}
        onDragStart={() => play("pop")}
        whileDrag={{ scale: 1.08, rotate: props.rotate * 0.4, zIndex: 40 }}
        initial={reduce ? false : { opacity: 0, scale: 0, rotate: props.rotate - 30 }}
        animate={entered ? { opacity: 1, scale: 1, rotate: props.rotate } : undefined}
        transition={{ delay: props.delay, duration: 0.75, ease: EASE_BACK }}
        className="sticker touch-none select-none"
      >
        {props.children}
      </motion.div>
    </motion.div>
  );
}

export function Hero() {
  const reduce = useReducedMotion();
  const { entered } = useExperience();
  const ref = useRef<HTMLElement>(null);
  const { scrollY } = useScroll();
  // The two lines drift apart as you scroll: line one right, line two left.
  const line1 = useTransform(scrollY, (v) => `${v / 100}%`);
  const line2 = useTransform(scrollY, (v) => `${-v * 0.0122}%`);
  const fade = (d: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 24 }, animate: entered ? { opacity: 1, y: 0 } : undefined, transition: { delay: d, duration: 0.9, ease: EASE_OUT } };

  return (
    <section
      ref={ref}
      id="top"
      className="paper-texture relative min-h-[100svh] overflow-hidden bg-paper pt-[104px] pb-[12vw] [--texture-strength:0.85] md:pt-[118px] md:pb-[7vw]"
    >
      <div className="relative px-[var(--gutter)]">
        <motion.div {...fade(0.5)} className="label flex items-center justify-between text-[11px] text-ink/70">
          <span>(01) AI video editor</span>
          <span className="hidden md:inline">Muse Spark + SAM 3.1 / built on Meta</span>
        </motion.div>
        <motion.p {...fade(0.55)} className="mt-5 font-mono text-[clamp(15px,1.5vw,21px)] md:mt-7">
          <Typewriter />
        </motion.p>

        <h1 className="display mt-3 text-[clamp(64px,19vw,300px)] leading-[0.86] md:mt-2 md:text-[clamp(78px,11.6vw,300px)]">
          <span className="sr-only">Shoot raw. Just say cut.</span>
          <motion.span aria-hidden className="flex flex-wrap items-center gap-x-[0.18em]" style={reduce ? undefined : { x: line1 }}>
            <Tile />
            <Word text="Shoot" start={0.1} />
            <Word text="raw." start={0.28} shaky />
          </motion.span>
          <motion.span aria-hidden className="flex flex-wrap items-center justify-end gap-x-[0.18em] text-tomato" style={reduce ? undefined : { x: line2 }}>
            <Word text="Just" start={0.38} />
            <Word text="say" start={0.5} />
            <Word text="cut." start={0.62} />
          </motion.span>
        </h1>

        <div className="mt-8 flex flex-col gap-8 md:mt-10 md:flex-row md:items-end md:justify-between">
          <div className="max-w-[460px]">
            <motion.p {...fade(0.8)} className="text-[clamp(17px,1.45vw,21px)] leading-[1.35] tracking-[-0.01em]">
              Auteur is a video editor for <strong className="font-semibold">raw footage</strong> and{" "}
              <strong className="font-semibold">people who&apos;d rather not scrub</strong>. Say what you want; it watches, listens, cuts and checks its own work.
            </motion.p>
            <motion.div {...fade(0.9)} className="mt-6 flex flex-wrap gap-3">
              <PillButton href="/signup">Start editing</PillButton>
              <PillButton href="#work" tone="paper">
                See the cuts
              </PillButton>
            </motion.div>
          </div>
          <motion.div
            className="hidden md:block"
            initial={reduce ? false : { opacity: 0, scale: 0.4, rotate: -90 }}
            animate={entered ? { opacity: 1, scale: 1, rotate: 0 } : undefined}
            transition={{ delay: 1.1, duration: 0.9, ease: EASE_BACK }}
          >
            <RotatingBadge text="SCROLL · SHOOT RAW · SAY CUT · " className="size-[138px]" tone="lime">
              <ArrowDown size={30} weight="bold" className="text-lime" />
            </RotatingBadge>
          </motion.div>
        </div>
      </div>

      {/* Stickers, placed and weighted like the reference's. */}
      <Sticker scrollY={scrollY} bounds={ref} speed={1.4} rotate={-12} delay={1.15} className="top-[19%] right-[5%] md:top-[17%] md:right-[9%]">
        <div className="grid size-[104px] place-items-center rounded-full border-2 border-ink bg-lime text-center text-forest md:size-[150px]">
          <div>
            <p className="label text-[10px] md:text-[11px]">subjects tracked</p>
            <p className="display text-[38px] leading-none md:text-[56px]">83%</p>
          </div>
        </div>
      </Sticker>
      <Sticker scrollY={scrollY} bounds={ref} speed={0.8} rotate={7} delay={1.2} className="top-[10.5%] left-[30%] hidden md:block">
        <span className="flex items-center gap-2 rounded-full border-2 border-ink bg-paper px-4 py-2 text-[15px] font-semibold">
          <span className="flex gap-1">
            {["bg-blue", "bg-tomato", "bg-sun", "bg-lime"].map((c) => (
              <i key={c} className={`size-2.5 rounded-full ${c}`} />
            ))}
          </span>
          Muse Spark
        </span>
      </Sticker>
      <Sticker scrollY={scrollY} bounds={ref} speed={1.2} rotate={-14} delay={1.25} className="top-[11%] left-[47%] hidden lg:block">
        <Image src="/assets/mascot.png" alt="" width={92} height={92} draggable={false} />
      </Sticker>
      <Sticker scrollY={scrollY} bounds={ref} speed={1.8} rotate={14} delay={1.3} className="right-[5%] bottom-[12%] md:right-auto md:bottom-[24%] md:left-[46%]">
        <Starburst color="#2e3bff" className="size-[96px] md:size-[128px]">
          <p className="label text-[10px] text-paper">fillers</p>
          <p className="display text-[28px] leading-none text-paper md:text-[36px]">-eee</p>
        </Starburst>
      </Sticker>
      <Sticker scrollY={scrollY} bounds={ref} speed={0.6} rotate={-6} delay={1.35} className="right-[14%] bottom-[19%] hidden md:block">
        <div className="w-[170px] border-2 border-ink bg-white p-2.5 pb-3">
          <div className="relative aspect-square overflow-hidden border-2 border-ink">
            <Image src="/assets/polaroid.jpg" alt="A night shot, graded warm" fill sizes="170px" className="object-cover" draggable={false} />
            <span className="display absolute inset-0 grid place-items-center text-center text-[40px] leading-[0.85] text-paper [text-shadow:0_2px_0_var(--ink)]">
              take
              <br />
              07
            </span>
            <span className="label absolute bottom-1.5 left-1.5 rounded bg-ink px-1.5 py-0.5 text-[9px] text-paper">graded</span>
          </div>
          <p className="mt-1.5 text-center font-hand text-[19px] leading-none">night walk, warm grade</p>
        </div>
      </Sticker>
      <Sticker scrollY={scrollY} bounds={ref} speed={1.1} rotate={-9} delay={1.4} className="bottom-[13%] left-[36%] hidden lg:block">
        <span className="flex items-center gap-2 rounded-full border-2 border-ink bg-pink px-4 py-2 text-[15px] font-semibold">
          <Heart size={15} weight="fill" className="text-tomato" /> Reels-ready
        </span>
      </Sticker>
      <Sticker scrollY={scrollY} bounds={ref} speed={1.5} rotate={4} delay={1.45} className="bottom-[14%] left-[60%] hidden xl:block">
        <div className="border-2 border-ink bg-sun px-4 py-1.5 [clip-path:polygon(0_0,100%_0,100%_35%,96%_50%,100%_65%,100%_100%,0_100%,0_65%,4%_50%,0_35%)]">
          <p className="label text-[9px]">certified</p>
          <p className="display text-[22px] tracking-normal normal-case">beat-synced</p>
        </div>
      </Sticker>

      <motion.div
        className="pointer-events-none absolute top-[10%] right-[12%] hidden items-start gap-1 text-ink md:top-[11%] md:right-[20%] md:flex"
        initial={reduce ? false : { opacity: 0 }}
        animate={entered ? { opacity: 1 } : undefined}
        transition={{ delay: 1.7, duration: 0.6 }}
      >
        <span className="-rotate-6 font-hand text-[22px] leading-none">
          psst. these stick.
          <br /> go on, drag &apos;em.
        </span>
        <svg className="mt-3 h-[56px] w-[100px] rotate-[-8deg] -scale-y-100" viewBox="0 0 160 90" fill="none" aria-hidden>
          <path d="M4 70 C 40 20, 100 10, 150 40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <path d="M136 26 L151 41 L131 47" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </motion.div>
    </section>
  );
}
