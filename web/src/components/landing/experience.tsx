"use client";

import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import Image from "next/image";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

gsap.registerPlugin(ScrollTrigger);

/*
 * The landing page's "experience" layer, themed on editing: a film-leader countdown that opens like a
 * shutter, a playhead cursor that reads the page as a timeline, opt-in sound effects
 * (public/assets/sfx/) and smooth scrolling.
 */

type Sfx = "pop" | "tick" | "clap" | "beep" | "projector";

const SFX: Record<Sfx, { src: string; volume: number }> = {
  pop: { src: "/assets/sfx/pop.mp3", volume: 0.5 },
  tick: { src: "/assets/sfx/tick.mp3", volume: 0.25 },
  clap: { src: "/assets/sfx/clap.mp3", volume: 0.6 },
  beep: { src: "/assets/sfx/beep.mp3", volume: 0.4 },
  projector: { src: "/assets/sfx/projector.mp3", volume: 0.35 },
};

const Experience = createContext<{ entered: boolean; sound: boolean; setSound: (on: boolean) => void; play: (s: Sfx) => void }>({
  entered: true,
  sound: false,
  setSound: () => {},
  play: () => {},
});

export const useExperience = () => useContext(Experience);

const INTRO_KEY = "auteur:intro-seen";
const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export function ExperienceProvider({ children }: { children: React.ReactNode }) {
  const [entered, setEntered] = useState(false);
  const [intro, setIntro] = useState(true);
  const [sound, setSound] = useState(false);
  const clips = useRef<Partial<Record<Sfx, HTMLAudioElement>>>({});
  const lenis = useRef<Lenis | null>(null);

  // Smooth, weighted scrolling (Lenis) driving GSAP's ScrollTrigger from one ticker.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const l = new Lenis({ lerp: 0.1 });
    lenis.current = l;
    l.on("scroll", ScrollTrigger.update);
    const tick = (t: number) => l.raf(t * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      l.destroy();
      lenis.current = null;
    };
  }, []);

  // No scrolling behind the intro gate.
  useEffect(() => {
    if (intro) lenis.current?.stop();
    else lenis.current?.start();
  }, [intro]);

  // The gate shows once per browser session; later visits go straight in.
  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(INTRO_KEY) === "1";
    } catch {}
    if (seen) {
      const id = requestAnimationFrame(() => {
        setIntro(false);
        setEntered(true);
      });
      return () => cancelAnimationFrame(id);
    }
  }, []);

  // Each play clones a preloaded element, so quick repeats (ticks on a nav) overlap instead of cutting off.
  const fire = useCallback((s: Sfx) => {
    let base = clips.current[s];
    if (!base) {
      base = new Audio(SFX[s].src);
      base.preload = "auto";
      clips.current[s] = base;
    }
    const a = base.cloneNode() as HTMLAudioElement;
    a.volume = SFX[s].volume;
    a.play().catch(() => {});
  }, []);

  const play = useCallback((s: Sfx) => sound && fire(s), [sound, fire]);

  const enter = (withSound: boolean) => {
    setSound(withSound);
    if (withSound) {
      fire("beep");
      setTimeout(() => fire("clap"), 380);
    }
    try {
      sessionStorage.setItem(INTRO_KEY, "1");
    } catch {}
    setIntro(false);
    // The hero starts once the shutter is mostly open.
    setTimeout(() => setEntered(true), 650);
  };

  return (
    <Experience.Provider value={{ entered, sound, setSound, play }}>
      {children}
      <AnimatePresence>{intro && <Leader onEnter={enter} />}</AnimatePresence>
      <PlayheadCursor />
      <SoundToggle />
    </Experience.Provider>
  );
}

/**
 * A film leader: crosshair, rings and a sweeping hand counting 3, 2, 1, then the mascot and the two ways
 * in. It leaves like a shutter, closing to a line across the middle.
 */
function Leader({ onEnter }: { onEnter: (sound: boolean) => void }) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? 0 : 3);
  const [frames, setFrames] = useState(0);

  useEffect(() => {
    if (n <= 0) return;
    const t = setTimeout(() => setN(n - 1), 720);
    return () => clearTimeout(t);
  }, [n]);

  // A running timecode in the corner, 24 frames a second.
  useEffect(() => {
    if (reduce) return;
    const t0 = performance.now();
    let id = 0;
    const loop = (now: number) => {
      setFrames(Math.floor(((now - t0) / 1000) * 24));
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [reduce]);

  const ready = n === 0;
  const tc = `00:00:${String(Math.floor(frames / 24) % 60).padStart(2, "0")}:${String(frames % 24).padStart(2, "0")}`;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Auteur"
      className="mat fixed inset-0 z-[70] flex flex-col px-[var(--gutter)] py-5 text-paper"
      initial={{ clipPath: "inset(0% 0% 0% 0%)" }}
      exit={{ clipPath: "inset(50% 0% 50% 0%)" }}
      transition={{ duration: 0.8, delay: 0.15, ease: [0.76, 0, 0.24, 1] }}
    >
      <motion.div className="flex flex-1 flex-col" exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
        <div className="flex items-start justify-between">
          <p className="label text-[10px] text-paper/50">Auteur / reel 01</p>
          <p className="label text-right text-[10px] leading-relaxed text-paper/50">
            Muse Spark · SAM 3.1
            <br />
            Wonder · Image · Voice
          </p>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <AnimatePresence mode="wait">
            {!ready ? (
              <motion.div key="leader" exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.3 }} className="relative grid size-[min(64vmin,420px)] place-items-center">
                {/* The sweep: a wedge that turns once per number. */}
                <motion.div
                  key={n}
                  className="absolute inset-0 rounded-full"
                  style={{ background: "conic-gradient(from 0deg, rgb(242 238 227 / 0.16) var(--sweep), transparent 0)" }}
                  initial={{ "--sweep": "0deg" } as never}
                  animate={{ "--sweep": "360deg" } as never}
                  transition={{ duration: 0.7, ease: "linear" }}
                />
                <div className="absolute inset-0 rounded-full border-2 border-paper/70" />
                <div className="absolute inset-[9%] rounded-full border border-paper/40" />
                <div className="absolute inset-y-0 left-1/2 w-px bg-paper/40" />
                <div className="absolute inset-x-0 top-1/2 h-px bg-paper/40" />
                <motion.span
                  key={`n${n}`}
                  initial={{ scale: 1.25, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.25 }}
                  className="display relative text-[min(40vmin,260px)] leading-none text-paper"
                >
                  {n}
                </motion.span>
              </motion.div>
            ) : (
              <motion.div key="ready" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE_OUT }} className="flex flex-col items-center">
                <motion.div animate={reduce ? undefined : { y: [0, -12, 0], rotate: [0, 3, -2, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}>
                  <Image src="/assets/mascot.webp" alt="" width={190} height={190} priority className="drop-shadow-[0_30px_40px_rgba(0,0,0,0.5)]" />
                </motion.div>
                <p className="display mt-5 text-[clamp(40px,5vw,64px)] leading-[0.9]">Say the edit.</p>
                <p className="font-serif text-[clamp(30px,3.6vw,46px)] leading-none italic text-lime">get the cut.</p>
                <div className="mt-8 flex flex-col items-center gap-3">
                  <button
                    type="button"
                    autoFocus
                    onClick={() => onEnter(true)}
                    className="inline-flex items-center gap-2.5 rounded-full bg-paper px-5 py-2.5 text-[14px] font-semibold text-ink transition-transform hover:scale-[1.04] active:scale-[0.97]"
                  >
                    <span className="size-2.5 animate-pulse rounded-full bg-[#ff3b30]" /> Enter with sound
                  </button>
                  <button type="button" onClick={() => onEnter(false)} className="text-[13px] text-paper/55 underline-offset-4 hover:text-paper hover:underline">
                    Enter quietly
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-end justify-between">
          <p className="font-mono text-[clamp(18px,2vw,26px)] tabular-nums text-paper/80">{tc}</p>
          <p className="label pb-1 text-right text-[10px] leading-relaxed text-paper/50">
            Sound on?
            <br />
            It starts with a clap.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * The cursor is a playhead: a tomato line with a head, and a timecode that reads how far down the page
 * you are (one second per 400px, 24 fps). It says CUT over links and GRAB over stickers.
 */
function PlayheadCursor() {
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const sx = useSpring(x, { stiffness: 700, damping: 48, mass: 0.3 });
  const sy = useSpring(y, { stiffness: 700, damping: 48, mass: 0.3 });
  const [state, setState] = useState<"idle" | "hover" | "grab">("idle");
  const [on, setOn] = useState(false);
  const label = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.documentElement.classList.add("has-cursor");
    const move = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
      setOn(true);
      const t = e.target as HTMLElement;
      setState(t.closest("[data-cursor='drag']") ? "grab" : t.closest("a, button, input, textarea, [data-cursor]") ? "hover" : "idle");
    };
    const leave = () => setOn(false);
    // The timecode is written straight to the DOM: it changes every frame while scrolling.
    let id = 0;
    const loop = () => {
      const f = Math.floor((window.scrollY / 400) * 24);
      const tc = `${String(Math.floor(f / 1440)).padStart(2, "0")}:${String(Math.floor(f / 24) % 60).padStart(2, "0")}:${String(f % 24).padStart(2, "0")}`;
      if (label.current && label.current.textContent !== tc) label.current.textContent = tc;
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    window.addEventListener("pointermove", move);
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(id);
      document.documentElement.classList.remove("has-cursor");
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [x, y]);

  const color = state === "idle" ? "#ff4f1f" : state === "grab" ? "#2e3bff" : "#121110";
  return (
    <motion.div aria-hidden className="pointer-events-none fixed top-0 left-0 z-[95] hidden [@media(pointer:fine)]:block" style={{ x: sx, y: sy, opacity: on ? 1 : 0 }}>
      <motion.div className="absolute -translate-x-1/2" animate={{ height: state === "idle" ? 34 : 48, top: state === "idle" ? -17 : -24 }} transition={{ duration: 0.3, ease: EASE_OUT }}>
        <svg width="14" height="9" viewBox="0 0 14 9" className="absolute -top-[7px] left-1/2 -translate-x-1/2">
          <path d="M1 1h12L7 8z" fill={color} stroke="#f2eee3" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <span className="block h-full w-[3px] rounded-full shadow-[0_0_0_1.5px_#f2eee3]" style={{ background: color }} />
      </motion.div>
      <span
        className="absolute top-[14px] left-[10px] rounded-[4px] px-1.5 py-0.5 font-mono text-[10px] leading-none font-medium tracking-[0.06em] whitespace-nowrap text-paper tabular-nums"
        style={{ background: color }}
      >
        {/* The timecode span has no React children: the loop above owns its text. */}
        <span ref={label} className={state === "idle" ? "" : "hidden"} />
        {state !== "idle" && (state === "grab" ? "GRAB" : "CUT")}
      </span>
    </motion.div>
  );
}

function SoundToggle() {
  const { sound, setSound, entered, play } = useExperience();
  if (!entered) return null;
  return (
    <button
      type="button"
      onClick={() => {
        setSound(!sound);
        if (!sound) new Audio(SFX.pop.src).play().catch(() => {});
        else play("tick");
      }}
      aria-pressed={sound}
      aria-label={sound ? "Turn sound off" : "Turn sound on"}
      className="fixed right-5 bottom-5 z-50 grid size-12 place-items-center rounded-full border-2 border-ink bg-paper text-ink shadow-[0_3px_0_0_var(--ink)] transition-transform hover:-rotate-12 active:translate-y-0.5"
    >
      {sound ? <SpeakerHigh size={18} weight="bold" className="text-tomato" /> : <SpeakerSlash size={18} weight="bold" />}
    </button>
  );
}
