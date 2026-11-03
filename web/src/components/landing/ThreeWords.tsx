"use client";

import { Heart, Microphone } from "@phosphor-icons/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { Kicker } from "./primitives";

gsap.registerPlugin(ScrollTrigger);

const FEED = [
  { label: "KEEPER", bg: "var(--tomato)" },
  { lines: true, bg: "var(--paper)" },
  { label: "BEST TAKE", bg: "var(--blue)" },
  { lines: true, bg: "var(--paper)" },
  { label: "ON BEAT", bg: "var(--pink)" },
  { lines: true, bg: "var(--sun)" },
];

/**
 * The whole job in three words, pinned and panned sideways (sizes in em of one giant font size, as in
 * the reference): a phone whose feed scrolls while you do, a transcript pill with the fillers struck,
 * and props floating at their own speed.
 */
export function ThreeWords() {
  const pin = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce || !pin.current || !track.current) return;
    const ctx = gsap.context(() => {
      const distance = () => track.current!.scrollWidth - window.innerWidth;
      const st = { trigger: pin.current, start: "top top", end: () => `+=${distance()}`, scrub: 1, invalidateOnRefresh: true };
      const pan = gsap.to(track.current, { x: () => -distance(), ease: "none", scrollTrigger: { ...st, pin: true } });
      gsap.to("[data-feed]", { yPercent: -50, ease: "none", scrollTrigger: st });
      gsap.utils.toArray<HTMLElement>("[data-float]").forEach((el) => {
        gsap.to(el, { x: () => -distance() * Number(el.dataset.float), ease: "none", scrollTrigger: st });
      });
      gsap.to("[data-filler]", {
        "--strike": 1,
        stagger: 0.3,
        ease: "none",
        scrollTrigger: { trigger: "[data-transcript]", containerAnimation: pan, start: "left 75%", end: "right 60%", scrub: true },
      });
    }, pin);
    return () => ctx.revert();
  }, [reduce]);

  return (
    <section className="paper-texture relative bg-lime text-forest [--texture-strength:0.7]">
      <div ref={pin} className={`relative overflow-hidden ${reduce ? "py-32" : "h-[100svh]"}`}>
        <div className="absolute top-[var(--gutter)] left-[var(--gutter)] z-10 mt-16">
          <Kicker>The whole job, in three words</Kicker>
        </div>

        <div
          ref={track}
          className={`display flex items-center gap-[5vw] pl-[8vw] text-[clamp(150px,27vw,520px)] leading-[0.8] whitespace-nowrap will-change-transform ${
            reduce ? "flex-wrap pt-24" : "absolute top-1/2 left-0 -translate-y-1/2"
          }`}
        >
          <span>Watch</span>

          <span className="relative inline-block h-[0.86em] w-[0.46em] shrink-0 rotate-[-6deg] overflow-hidden rounded-[0.06em] border-[5px] border-forest bg-forest">
            <span data-feed className="absolute inset-x-0 top-0 flex flex-col gap-[0.02em] p-[0.025em]">
              {[...FEED, ...FEED].map((f, i) => (
                <span key={i} className="relative flex h-[0.3em] shrink-0 items-center justify-center rounded-[0.02em] text-ink" style={{ background: f.bg }}>
                  {f.label ? (
                    <span className="text-[0.075em] tracking-[0.02em]">{f.label}</span>
                  ) : (
                    <span className="flex w-full flex-col gap-[0.025em] px-[0.04em]">
                      <i className="h-[0.03em] w-3/4 rounded-full bg-ink/15" />
                      <i className="h-[0.03em] w-1/2 rounded-full bg-ink/10" />
                    </span>
                  )}
                </span>
              ))}
            </span>
            <span className="absolute top-[0.02em] left-1/2 h-[0.03em] w-[0.14em] -translate-x-1/2 rounded-full bg-forest" />
          </span>

          <span>listen</span>

          <span
            data-transcript
            className="relative inline-flex h-[0.42em] shrink-0 rotate-[3deg] items-center gap-[0.06em] rounded-full border-[5px] border-forest bg-paper px-[0.1em] text-ink"
          >
            <Microphone weight="bold" className="size-[0.18em] text-blue" />
            <span className="font-mono text-[0.12em] tracking-normal normal-case text-ink/80">
              so{" "}
              <span data-filler className="relative text-tomato [--strike:0] after:absolute after:top-1/2 after:left-0 after:h-[0.08em] after:w-full after:origin-left after:scale-x-[var(--strike)] after:bg-tomato">
                um
              </span>{" "}
              today we&apos;re{" "}
              <span data-filler className="relative text-tomato [--strike:0] after:absolute after:top-1/2 after:left-0 after:h-[0.08em] after:w-full after:origin-left after:scale-x-[var(--strike)] after:bg-tomato">
                uh
              </span>{" "}
              walking to the market
            </span>
            <span className="ml-[0.04em] inline-block h-[0.16em] w-[3px] animate-pulse bg-blue" />
          </span>

          <span className="relative">
            cut.
            <span className="absolute -bottom-[0.32em] left-[0.4em] flex items-start gap-2 text-forest">
              <svg className="h-[70px] w-[120px] rotate-[200deg] -scale-x-100" viewBox="0 0 160 90" fill="none" aria-hidden>
                <path d="M4 70 C 40 20, 100 10, 150 40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                <path d="M136 26 L151 41 L131 47" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="mt-6 font-hand text-[clamp(20px,2vw,30px)] leading-none tracking-normal whitespace-nowrap normal-case">
                Muse Spark looks at
                <br />
                frames from every clip.
              </span>
            </span>
          </span>

          <span className="pr-[12vw] font-serif text-[0.34em] leading-[1] tracking-normal normal-case italic text-forest/80">
            (then it checks
            <br />its work.)
          </span>
        </div>

        {!reduce && (
          <>
            <div data-float="0.25" className="pointer-events-none absolute top-[14%] left-[62%]">
              <div className="grid size-[110px] place-items-center rounded-full border-2 border-forest bg-pink text-ink">
                <Heart size={44} weight="fill" className="beat text-tomato" />
              </div>
            </div>
            <div data-float="0.6" className="pointer-events-none absolute top-[70%] left-[110%]">
              <div className="rounded-full border-2 border-forest bg-paper px-5 py-2.5 text-[18px] font-semibold whitespace-nowrap text-ink">+1 keeper</div>
            </div>
            <div data-float="0.45" className="pointer-events-none absolute top-[20%] left-[190%]">
              <div className="rounded-full border-2 border-forest bg-sun px-5 py-2.5 text-[18px] font-semibold whitespace-nowrap text-ink">−2 fillers</div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
