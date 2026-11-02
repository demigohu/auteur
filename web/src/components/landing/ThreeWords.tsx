"use client";

import { Heart, Microphone, Sparkle } from "@phosphor-icons/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useRef } from "react";
import { Kicker } from "./primitives";

gsap.registerPlugin(ScrollTrigger);

const TRANSCRIPT = ["so", "um", "today", "we're", "walking", "uh", "to", "the", "night", "market"];
const FILLERS = new Set(["um", "uh"]);

/** The whole job in three words, pinned and panned sideways with props between the words. */
export function ThreeWords() {
  const wrap = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce || !wrap.current || !track.current) return;
    const ctx = gsap.context(() => {
      const distance = () => track.current!.scrollWidth - window.innerWidth;
      const pan = gsap.to(track.current, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: { trigger: wrap.current, start: "top top", end: () => `+=${distance()}`, pin: true, scrub: 1, invalidateOnRefresh: true },
      });
      // Fillers get struck through as the transcript pill crosses the middle of the screen.
      gsap.to("[data-filler]", {
        "--strike": 1,
        stagger: 0.2,
        ease: "none",
        scrollTrigger: { trigger: "[data-transcript]", containerAnimation: pan, start: "left 70%", end: "center 40%", scrub: true },
      });
    }, wrap);
    return () => ctx.revert();
  }, [reduce]);

  return (
    <section ref={wrap} className="paper-texture relative overflow-hidden bg-lime text-forest [--texture-strength:0.7]">
      <div className="absolute top-28 left-[var(--gutter)] z-10">
        <Kicker>The whole job, in three words</Kicker>
      </div>
      <div
        ref={track}
        className={`flex h-[100dvh] items-center gap-[5vw] pr-[12vw] pl-[var(--gutter)] ${reduce ? "flex-wrap py-40" : "w-max"}`}
      >
        <Word>Watch</Word>

        {/* A phone mid-scroll: the frames the agent looked at. */}
        <div className="relative shrink-0">
          <span className="absolute -top-20 left-1/2 grid size-16 -translate-x-1/2 place-items-center rounded-full border-2 border-forest bg-pink">
            <Heart size={26} weight="fill" className="text-tomato" />
          </span>
          <div className="w-[170px] rotate-[8deg] rounded-[26px] border-[3px] border-forest bg-forest p-2 shadow-[8px_10px_0_0_rgba(14,58,34,0.35)]">
            <div className="overflow-hidden rounded-[18px] bg-paper">
              <div className="relative h-[110px]">
                <Image src="/assets/phone-reel.jpg" alt="" fill sizes="170px" className="object-cover" />
                <span className="display absolute top-2 left-2 rounded-[4px] bg-tomato px-1.5 text-[20px] text-ink">Keeper</span>
              </div>
              <div className="space-y-1.5 p-3">
                <div className="h-2 w-3/4 rounded-full bg-forest/20" />
                <div className="h-2 w-1/2 rounded-full bg-forest/20" />
              </div>
              <div className="display bg-blue px-3 py-3 text-[22px] text-paper">Best take</div>
            </div>
          </div>
        </div>

        <Word>Listen</Word>

        {/* The transcript pill: what the agent heard, fillers struck out. */}
        <div data-transcript className="relative shrink-0">
          <div className="flex -rotate-3 items-center gap-4 rounded-full border-[3px] border-forest bg-paper py-5 pr-8 pl-6 font-mono text-[clamp(20px,2.2vw,34px)] text-ink">
            <Microphone size={34} weight="bold" className="shrink-0 text-blue" />
            <span className="whitespace-nowrap">
              {TRANSCRIPT.map((w, i) =>
                FILLERS.has(w) ? (
                  <span
                    key={i}
                    data-filler
                    className="relative mx-1 text-tomato [--strike:0] after:absolute after:top-1/2 after:left-0 after:h-[3px] after:w-full after:origin-left after:scale-x-[var(--strike)] after:bg-tomato"
                  >
                    {w}
                  </span>
                ) : (
                  <span key={i} className="mx-1">
                    {w}
                  </span>
                ),
              )}
            </span>
            <span className="h-9 w-[3px] animate-pulse bg-blue" />
          </div>
          <span className="absolute -bottom-16 left-24 rotate-[-8deg] rounded-full border-2 border-forest bg-paper px-4 py-2 text-[14px] font-semibold text-ink">
            −2 fillers
          </span>
        </div>

        <Word>Cut.</Word>

        <div className="flex shrink-0 flex-col gap-6">
          <Sparkle size={44} weight="fill" className="text-tomato" />
          <p className="font-serif text-[clamp(56px,8vw,128px)] leading-[0.95] italic text-forest/90">
            (and then
            <br />a check.)
          </p>
          <p className="rotate-[-3deg] font-hand text-[26px] text-forest">every cut is checked before you see it.</p>
        </div>
      </div>
    </section>
  );
}

function Word({ children }: { children: React.ReactNode }) {
  return <p className="display shrink-0 text-[clamp(140px,26vw,420px)] leading-[0.8]">{children}</p>;
}
