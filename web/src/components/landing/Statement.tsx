"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useEffect, useId, useRef } from "react";
import { Kicker } from "./primitives";

gsap.registerPlugin(ScrollTrigger);

/** A gentle S-wave across a 1440-wide strip: cubic segments 648 apart, amplitude `amp` around the middle. */
function wavePath(height: number, amp: number, flip: boolean) {
  const mid = height / 2;
  const a = flip ? -amp : amp;
  let d = `M -777.6 ${mid}`;
  for (let i = 0; i < 5; i++) {
    const x = -777.6 + i * 648;
    const s = i % 2 === 0 ? a : -a;
    d += ` C ${(x + 233.28).toFixed(2)} ${mid + s}, ${(x + 414.72).toFixed(2)} ${mid + s}, ${(x + 648).toFixed(2)} ${mid}`;
  }
  return d;
}

/**
 * One ribbon: a thick stroked wave (ink outline under the color) with words riding it on a textPath.
 * The words drift on their own and run faster while the page scrolls.
 */
function Ribbon(props: { words: string[]; height: number; amp: number; flip: boolean; color: string; ink: string; size: number; speed: number; scrollFactor: number }) {
  const id = useId().replace(/:/g, "");
  const textPath = useRef<SVGTextPathElement>(null);
  const measure = useRef<SVGTextElement>(null);
  const holes = useRef<SVGGElement>(null);
  const reduce = useReducedMotion();
  const unit = props.words.map((w) => `${w}  ✺  `).join("");
  const d = wavePath(props.height, props.amp, props.flip);

  useEffect(() => {
    if (reduce || !textPath.current || !measure.current) return;
    const length = measure.current.getComputedTextLength();
    const hole = props.size * 0.62;
    let frame = 0;
    let t0 = performance.now();
    const tick = (now: number) => {
      const shift = ((now - t0) / 1000) * props.speed + window.scrollY * props.scrollFactor;
      const offset = -(((shift % length) + length) % length);
      textPath.current?.setAttribute("startOffset", offset.toFixed(1));
      // The sprocket holes travel with the words, so the strip reads as film running through a gate.
      holes.current?.style.setProperty("stroke-dashoffset", (-offset % hole).toFixed(1));
      frame = requestAnimationFrame(tick);
    };
    t0 = performance.now();
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduce, props.speed, props.scrollFactor, props.size]);

  return (
    <div className="pointer-events-none relative w-full" style={{ height: props.height }} aria-hidden>
      <svg width="100%" height={props.height} viewBox={`0 0 1440 ${props.height}`} className="absolute inset-0 overflow-visible">
        <defs>
          <path id={`wave-${id}`} d={d} />
        </defs>
        <use href={`#wave-${id}`} stroke="#121110" strokeWidth={props.size * 2.3 + 5} fill="none" />
        <use href={`#wave-${id}`} stroke={props.color} strokeWidth={props.size * 2.3} fill="none" />
        {/* Sprocket holes along both edges: dashed copies of the wave, nudged up and down. */}
        <g ref={holes} stroke="#121110" strokeWidth={props.size * 0.2} strokeDasharray={`${props.size * 0.3} ${props.size * 0.32}`} fill="none">
          <use href={`#wave-${id}`} transform={`translate(0 ${-props.size * 0.88})`} />
          <use href={`#wave-${id}`} transform={`translate(0 ${props.size * 0.88})`} />
        </g>
      </svg>
      <svg width="100%" height={props.height} viewBox={`0 0 1440 ${props.height}`} className="absolute inset-0 overflow-visible">
        <defs>
          <path id={`wavet-${id}`} d={d} />
        </defs>
        <text ref={measure} fontSize={props.size} className="font-display uppercase" opacity="0" style={{ letterSpacing: "0.01em" }}>
          {unit}
        </text>
        <text fill={props.ink} fontSize={props.size} dominantBaseline="central" className="font-display uppercase" style={{ letterSpacing: "0.01em" }}>
          <textPath ref={textPath} href={`#wavet-${id}`} startOffset="0">
            {unit.repeat(6)}
          </textPath>
        </text>
      </svg>
    </div>
  );
}

/** The crossing ribbons on the seam between the hero and the manifesto (a zero-height layer). */
export function Ribbons() {
  return (
    <div className="pointer-events-none relative z-30 h-0" aria-hidden>
      <div className="absolute inset-x-0 top-0 -translate-y-[62%] rotate-[-3deg]">
        <Ribbon words={["Watch", "Listen", "Track", "Reframe", "Grade", "Subtitle", "Check"]} height={180} amp={46} flip={false} color="var(--tomato)" ink="#121110" size={40} speed={60} scrollFactor={0.8} />
      </div>
      <div className="absolute inset-x-0 top-0 -translate-y-[40%] rotate-[2deg]">
        <Ribbon words={["Cuts on the beat", "Captions timed to the word", "Checked before export", "16:9 · 9:16 · 1:1"]} height={218} amp={58} flip color="var(--lime)" ink="#0e3a22" size={48} speed={-45} scrollFactor={-1.07} />
      </div>
    </div>
  );
}

const WORDS: { text: string; box?: boolean; underline?: boolean }[] = [
  { text: "The" },
  { text: "good" },
  { text: "30", box: true },
  { text: "seconds", box: true },
  { text: "are" },
  { text: "already" },
  { text: "on" },
  { text: "your" },
  { text: "phone." },
  { text: "Auteur" },
  { text: "finds" },
  { text: "them.", underline: true },
]

/**
 * (lime) The manifesto. Its top edge is an arc that flattens as the hero scrolls away, and the words
 * light up one after another (opacity .14 to 1) while the text crosses the screen.
 */
export function Statement() {
  const root = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const arc = useTransform(scrollY, [0, 600], [14, 0], { clamp: true });
  const radius = useTransform(arc, (a) => `50% ${a}vw`);

  useEffect(() => {
    if (reduce || !root.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        "[data-mword]",
        { opacity: 0.14 },
        { opacity: 1, ease: "none", stagger: 0.25, scrollTrigger: { trigger: "[data-mtext]", start: "top 78%", end: "bottom 50%", scrub: true } },
      );
      const pct = root.current!.querySelector("[data-export-pct]");
      gsap.to("[data-export]", {
        scaleX: 1,
        ease: "none",
        scrollTrigger: {
          trigger: "[data-mtext]",
          start: "top 78%",
          end: "bottom 40%",
          scrub: true,
          onUpdate: (st) => pct && (pct.textContent = `${Math.round(st.progress * 100)}%`),
        },
      });
      gsap.fromTo(
        "[data-underline]",
        { strokeDashoffset: 600 },
        { strokeDashoffset: 0, ease: "none", scrollTrigger: { trigger: "[data-mtext]", start: "bottom 72%", end: "bottom 40%", scrub: true } },
      );
    }, root);
    return () => ctx.revert();
  }, [reduce]);

  const box = WORDS.filter((w) => w.box);
  const before = WORDS.slice(0, WORDS.indexOf(box[0]));
  const after = WORDS.slice(WORDS.indexOf(box[box.length - 1]) + 1);
  const word = (w: (typeof WORDS)[number]) => (
    <span data-mword className="relative inline-block">
      {w.text}
    </span>
  );

  return (
    <motion.section
      ref={root}
      className="paper-texture relative z-10 -mt-[6vw] bg-lime text-forest [--texture-strength:0.7]"
      style={reduce ? undefined : { borderTopLeftRadius: radius, borderTopRightRadius: radius }}
    >
      <div className="px-[var(--gutter)] pt-[46vw] pb-[10vw] md:pt-[16vw]">
        <div className="flex justify-center">
          <Kicker>Why it exists</Kicker>
        </div>
        <p
          data-mtext
          className="display relative mx-auto mt-8 max-w-[15ch] text-center text-[clamp(44px,7.4vw,128px)] leading-[0.9]"
          aria-label={WORDS.map((w) => w.text).join(" ")}
        >
          <span aria-hidden>
            {before.map((w, i) => (
              <span key={i}>{word(w)} </span>
            ))}
            <span className="relative inline-block rounded-[0.12em] bg-forest px-[0.12em] whitespace-nowrap text-lime">
              {box.map((w, i) => (
                <span key={i}>
                  {word(w)}
                  {i < box.length - 1 ? " " : ""}
                </span>
              ))}
            </span>{" "}
            {after.map((w, i) =>
              w.underline ? (
                <span key={i} className="relative inline-block">
                  {word(w)}
                  <svg className="absolute -bottom-[0.12em] left-0 h-[0.25em] w-full" viewBox="0 0 300 30" preserveAspectRatio="none" aria-hidden>
                    <path data-underline d="M4 20 C 60 6, 110 28, 160 14 S 250 6, 296 18" fill="none" stroke="#ff4f1f" strokeWidth="7" strokeLinecap="round" strokeDasharray="600" />
                  </svg>
                </span>
              ) : (
                <span key={i}>{word(w)} </span>
              ),
            )}
          </span>
        </p>
        {/* An export bar that fills as the sentence lights up. */}
        <div className="mx-auto mt-12 max-w-[420px]" aria-hidden>
          <div className="label flex justify-between text-[10px] text-forest/70">
            <span>exporting 1080×1920</span>
            <span data-export-pct className="tabular-nums">0%</span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full border-2 border-forest">
            <div data-export className="h-full origin-left scale-x-0 bg-forest" />
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-[540px] text-center text-[17px] leading-[1.45] md:text-[19px]">
          They&apos;re buried between shaky starts, long walks and &ldquo;wait, is it recording?&rdquo;. The agent watches every clip, keeps the moments that move, and
          puts them on a timeline in the order they happened.
        </p>
      </div>
    </motion.section>
  );
}
