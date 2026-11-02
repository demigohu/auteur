"use client";

import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import Image from "next/image";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

gsap.registerPlugin(ScrollTrigger);

/*
 * The landing page's "experience" layer, after the reference: an intro gate with a counter, opt-in
 * sound, a ring cursor and a floating sound toggle. Sounds are synthesized with Web Audio, so they need
 * no asset files; drop recorded ones in public/assets/sfx/ later and swap `play` to use them.
 */

type Sfx = "pop" | "tick" | "whoosh";

const Experience = createContext<{ entered: boolean; sound: boolean; setSound: (on: boolean) => void; play: (s: Sfx) => void }>({
  entered: true,
  sound: false,
  setSound: () => {},
  play: () => {},
});

export const useExperience = () => useContext(Experience);

const INTRO_KEY = "auteur:intro-seen";

function synth(ctx: AudioContext, kind: Sfx) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain).connect(ctx.destination);
  if (kind === "pop") {
    osc.type = "sine";
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(1100, t + 0.08);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.stop(t + 0.15);
  } else if (kind === "tick") {
    osc.type = "square";
    osc.frequency.setValueAtTime(1800, t);
    gain.gain.setValueAtTime(0.03, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    osc.stop(t + 0.04);
  } else {
    osc.type = "triangle";
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.5);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    osc.stop(t + 0.6);
  }
  osc.start(t);
}

export function ExperienceProvider({ children }: { children: React.ReactNode }) {
  const [entered, setEntered] = useState(false);
  const [intro, setIntro] = useState(true);
  const [sound, setSoundState] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const lenis = useRef<Lenis | null>(null);

  // Smooth, weighted scrolling (Lenis) driving GSAP's ScrollTrigger from one ticker, as the reference does.
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

  const play = useCallback(
    (s: Sfx) => {
      if (!sound || !audio.current) return;
      synth(audio.current, s);
    },
    [sound],
  );

  const setSound = useCallback((on: boolean) => {
    if (on && !audio.current) audio.current = new AudioContext();
    if (on) audio.current?.resume();
    setSoundState(on);
  }, []);

  const enter = (withSound: boolean) => {
    setSound(withSound);
    if (withSound && audio.current) synth(audio.current, "whoosh");
    try {
      sessionStorage.setItem(INTRO_KEY, "1");
    } catch {}
    setIntro(false);
    // The hero starts once the reveal circle has opened most of the way.
    setTimeout(() => setEntered(true), 700);
  };

  return (
    <Experience.Provider value={{ entered, sound, setSound, play }}>
      {children}
      <AnimatePresence>{intro && <Preloader onEnter={enter} />}</AnimatePresence>
      <RingCursor />
      <SoundToggle />
    </Experience.Provider>
  );
}

function Preloader({ onEnter }: { onEnter: (sound: boolean) => void }) {
  const reduce = useReducedMotion();
  const [count, setCount] = useState(0);

  useEffect(() => {
    const controls = animate(0, 100, { duration: reduce ? 0.2 : 2.2, ease: [0.65, 0, 0.35, 1], onUpdate: (v) => setCount(Math.round(v)) });
    return () => controls.stop();
  }, [reduce]);

  const ready = count >= 100;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Auteur"
      className="mat fixed inset-0 z-[70] flex flex-col px-[var(--gutter)] py-5 text-paper"
      // A hole opens in the middle and grows until the page shows through, like an iris wipe.
      style={{
        WebkitMaskImage: "radial-gradient(circle at 50% 50%, transparent var(--hole), #000 calc(var(--hole) + 1px))",
        maskImage: "radial-gradient(circle at 50% 50%, transparent var(--hole), #000 calc(var(--hole) + 1px))",
      }}
      initial={{ "--hole": "0vmax" } as never}
      exit={{ "--hole": "120vmax" } as never}
      transition={{ duration: 1.1, delay: 0.25, ease: [0.76, 0, 0.24, 1] }}
    >
      <motion.div className="flex flex-1 flex-col" exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <div className="flex items-start justify-between">
        <p className="label text-[10px] text-paper/50">Auteur® / AI video editor</p>
        <p className="label text-right text-[10px] leading-relaxed text-paper/50">
          Muse Spark
          <br />
          SAM 3.1
        </p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <motion.div
          animate={reduce ? undefined : { y: [0, -14, 0], rotate: [0, 3, -2, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        >
          <Image src="/assets/mascot.png" alt="" width={190} height={190} priority className="drop-shadow-[0_30px_40px_rgba(0,0,0,0.5)]" />
        </motion.div>
        <p className="mt-4 text-[17px] text-paper/90">hey. we make video you can</p>
        <p className="font-serif text-[30px] leading-none italic text-lime">talk to.</p>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: ready ? 1 : 0.35, y: 0 }} className="mt-7 flex flex-col items-center gap-3">
          <button
            type="button"
            disabled={!ready}
            onClick={() => onEnter(true)}
            className="inline-flex items-center gap-2.5 rounded-full bg-paper px-5 py-2.5 text-[14px] font-semibold text-ink transition-transform hover:scale-[1.04] active:scale-[0.97] disabled:cursor-wait"
          >
            enter with sound <span className="size-2 animate-pulse rounded-full bg-tomato" />
          </button>
          <button type="button" disabled={!ready} onClick={() => onEnter(false)} className="text-[13px] text-paper/50 underline-offset-4 hover:text-paper hover:underline disabled:cursor-wait">
            enter quietly
          </button>
        </motion.div>
      </div>

      <div className="flex items-end justify-between">
        <p className="display text-[clamp(72px,9vw,140px)] tabular-nums" aria-live="polite">
          {count}
        </p>
        <p className="label pb-3 text-right text-[10px] leading-relaxed text-paper/50">
          Headphones on?
          <br />
          Good.
        </p>
      </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * The reference's cursor: an ink ring with a paper halo that trails the pointer. Over links it grows
 * and fills lime; over anything marked data-cursor="drag" (stickers) it grows into a lime disc that
 * reads DRAG. Fine pointers only.
 */
function RingCursor() {
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const sx = useSpring(x, { stiffness: 600, damping: 45, mass: 0.35 });
  const sy = useSpring(y, { stiffness: 600, damping: 45, mass: 0.35 });
  const [state, setState] = useState<"idle" | "hover" | "label">("idle");
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.documentElement.classList.add("has-cursor");
    const move = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
      setOn(true);
      const t = e.target as HTMLElement;
      setState(t.closest("[data-cursor='drag']") ? "label" : t.closest("a, button, [data-cursor]") ? "hover" : "idle");
    };
    const leave = () => setOn(false);
    window.addEventListener("pointermove", move);
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      document.documentElement.classList.remove("has-cursor");
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [x, y]);

  const scale = state === "label" ? 1 : state === "hover" ? 0.62 : 0.36;
  return (
    <motion.div aria-hidden className="pointer-events-none fixed top-0 left-0 z-[95] hidden [@media(pointer:fine)]:block" style={{ x: sx, y: sy, opacity: on ? 1 : 0 }}>
      <motion.div
        className="grid size-[84px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-ink shadow-[0_0_0_3px_rgba(242,238,227,0.75)]"
        animate={{ scale, backgroundColor: state === "label" ? "rgba(200,245,60,1)" : state === "hover" ? "rgba(200,245,60,0.45)" : "rgba(200,245,60,0)" }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.span
          className="text-[11px] font-semibold tracking-[0.08em] text-ink uppercase"
          animate={{ opacity: state === "label" ? 1 : 0, scale: state === "label" ? 1 : 0.6 }}
          transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
        >
          drag
        </motion.span>
      </motion.div>
    </motion.div>
  );
}

function SoundToggle() {
  const { sound, setSound, entered } = useExperience();
  if (!entered) return null;
  return (
    <button
      type="button"
      onClick={() => setSound(!sound)}
      aria-pressed={sound}
      aria-label={sound ? "Turn sound off" : "Turn sound on"}
      className="fixed right-5 bottom-5 z-50 grid size-12 place-items-center rounded-full border-2 border-ink bg-paper text-ink shadow-[0_3px_0_0_var(--ink)] transition-transform hover:-rotate-12 active:translate-y-0.5"
    >
      {sound ? <SpeakerHigh size={18} weight="bold" className="text-tomato" /> : <SpeakerSlash size={18} weight="bold" />}
    </button>
  );
}
