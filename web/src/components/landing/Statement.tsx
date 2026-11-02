"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { Kicker } from "./primitives";

gsap.registerPlugin(ScrollTrigger);

const LEAD = "You shot";
const BOX = "40 minutes.";
const REST = "They'll watch about thirty seconds. We find";
const LAST = "them.";

/** (lime) The why, scrubbed in word by word as it scrolls up (docs/DESIGN.md, Motion: "scrub"). */
export function Statement() {
  const root = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce || !root.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        "[data-word]",
        { opacity: 0.14 },
        { opacity: 1, stagger: 0.12, ease: "none", scrollTrigger: { trigger: "[data-words]", start: "top 75%", end: "bottom 45%", scrub: true } },
      );
      gsap.fromTo(
        "[data-squiggle]",
        { strokeDashoffset: 400 },
        { strokeDashoffset: 0, ease: "none", scrollTrigger: { trigger: "[data-words]", start: "bottom 70%", end: "bottom 45%", scrub: true } },
      );
    }, root);
    return () => ctx.revert();
  }, [reduce]);

  const words = (text: string) =>
    text.split(" ").map((w, i) => (
      <span key={i} data-word className="inline-block">
        {w}&nbsp;
      </span>
    ));

  return (
    <section ref={root} className="paper-texture relative bg-lime px-[var(--gutter)] pt-[clamp(140px,20vh,220px)] pb-[clamp(120px,18vh,200px)] text-forest [--texture-strength:0.7]">
      <div className="mx-auto max-w-[1180px] text-center">
        <Kicker>Why it exists</Kicker>
        <h2 data-words className="display mt-8 text-[clamp(52px,7.6vw,124px)] leading-[0.9]">
          {words(LEAD)}
          <span data-word className="mx-1 inline-block -rotate-1 rounded-[8px] border-2 border-forest bg-forest px-3 pb-1 text-lime">
            {BOX}
          </span>{" "}
          {words(REST)}
          <span data-word className="relative inline-block">
            {LAST}
            <svg viewBox="0 0 300 30" className="absolute -bottom-3 left-0 h-5 w-full overflow-visible" aria-hidden>
              <path data-squiggle d="M4 18 C 50 4, 90 28, 140 14 S 230 6, 296 16" fill="none" stroke="#ff4f1f" strokeWidth="6" strokeLinecap="round" strokeDasharray="400" />
            </svg>
          </span>
        </h2>
        <p className="mx-auto mt-12 max-w-[52ch] text-[18px] leading-relaxed text-forest/85">
          Most of what you shot is setup, waiting and &ldquo;wait, is it recording?&rdquo;. The agent watches all of it, keeps the moments that move, and lays them on a
          timeline where you can still change your mind.
        </p>
      </div>
    </section>
  );
}
