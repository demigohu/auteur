"use client";

import { ArrowUpRight, CursorClick, Heart, MagnifyingGlass, Sparkle } from "@phosphor-icons/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Kicker } from "./primitives";
import { Fade, RevealLines } from "./reveal";

gsap.registerPlugin(ScrollTrigger);

/** The stack, set like client logos on a sun-yellow tape. */
const STACK: { name: string; cls: string }[] = [
  { name: "Muse Spark", cls: "font-serif italic text-[1.15em]" },
  { name: "SAM 3.1", cls: "font-display uppercase" },
  { name: "voice transcribe", cls: "font-mono tracking-[0.2em] uppercase text-[0.7em]" },
  { name: "FFmpeg", cls: "font-sans font-extrabold tracking-[-0.03em]" },
  { name: "Remotion", cls: "font-hand text-[1.25em] font-semibold" },
  { name: "OpenCV", cls: "font-display uppercase" },
  { name: "FastAPI", cls: "font-serif" },
];

export function StackTape() {
  const row = (
    <div className="flex shrink-0 items-center">
      {STACK.map((s) => (
        <span key={s.name} className="flex items-center gap-8 px-8 text-[clamp(28px,3vw,44px)] whitespace-nowrap text-ink">
          <span className={s.cls}>{s.name}</span>
          <Sparkle size={18} weight="fill" className="text-tomato" />
        </span>
      ))}
    </div>
  );
  return (
    <div className="relative z-10 -my-6 overflow-hidden py-6">
      <div className="-mx-4 -rotate-[2deg] border-y-2 border-ink bg-sun py-3" role="img" aria-label="Built with Muse Spark, SAM 3.1, Voice Transcribe, FFmpeg, Remotion, OpenCV and FastAPI">
        <div className="flex w-max motion-safe:animate-[marquee_44s_linear_infinite]">
          {row}
          {row}
          {row}
        </div>
      </div>
    </div>
  );
}

/** Section heading after the reference: kicker, two masked lines (display + serif aside), body on the right. */
export function Heading(props: {
  kicker: string;
  tone: "blue" | "tomato" | "forest" | "lime" | "ink" | "paper";
  title: string;
  accent: string;
  accentClass: string;
  body: string;
  dark?: boolean;
}) {
  return (
    <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
      <div className="lg:col-span-8">
        <Fade>
          <Kicker tone={props.tone}>{props.kicker}</Kicker>
        </Fade>
        <RevealLines
          className="mt-6 text-[clamp(58px,8.6vw,156px)] leading-[0.86]"
          lines={[
            { text: props.title, className: "display" },
            { text: props.accent, className: `font-serif italic normal-case pb-[0.04em] ${props.accentClass}` },
          ]}
        />
      </div>
      <Fade className="lg:col-span-4 lg:justify-self-end">
        <p className={`max-w-[440px] text-[18px] leading-[1.45] ${props.dark ? "text-paper/90" : ""}`}>{props.body}</p>
      </Fade>
    </div>
  );
}

/** Numbered rows; on hover a color floods up from the bottom and an arrow slides in (the reference's svc-row). */
function ServiceList(props: { items: readonly (readonly [string, string])[]; prefix: string; label: string; line: string; hoverBg: string; hoverFg: string; dark?: boolean }) {
  return (
    <div>
      <Fade>
        <p className={`label mb-5 text-[11px] ${props.dark ? "text-paper/70" : "text-ink/60"}`}>{props.label}</p>
      </Fade>
      <Fade>
        <ul style={{ "--line": props.line, "--hbg": props.hoverBg, "--hfg": props.hoverFg } as React.CSSProperties}>
          {props.items.map(([name, line], i) => (
            <li key={name} className="group relative overflow-hidden border-t-2 border-[var(--line)] last:border-b-2">
              <span className="absolute inset-0 origin-bottom scale-y-0 bg-[var(--hbg)] transition-transform duration-500 ease-[var(--ease-out)] group-hover:scale-y-100" />
              <div className="relative flex items-center gap-4 py-4 transition-colors duration-300 group-hover:text-[var(--hfg)] md:gap-6 md:py-5">
                <span className="label w-12 shrink-0 text-[11px] opacity-60">
                  {props.prefix}/{String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="display text-[clamp(34px,3.6vw,56px)] leading-[0.95]">{name}</p>
                  <p className="mt-1 max-w-[46ch] text-[14px] leading-snug opacity-75">{line}</p>
                </div>
                <ArrowUpRight
                  size={34}
                  weight="bold"
                  className="mr-2 shrink-0 -translate-x-3 translate-y-3 opacity-0 transition-all duration-500 ease-[var(--ease-out)] group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100"
                />
              </div>
            </li>
          ))}
        </ul>
      </Fade>
    </div>
  );
}

const AGENT_TOOLS = [
  ["Watch", "Muse Spark samples frames from every clip: who's in shot, what's happening, which moments have energy."],
  ["Listen", "Word-level transcripts, used for subtitles and for finding the ums."],
  ["Track", "SAM 3.1 follows a person, a face or a license plate through the whole clip."],
  ["Reframe", "Vertical and square versions where the crop follows the subject."],
  ["Grade", "Exposure and white balance fixed per clip, then every clip matched to the others."],
] as const;

const DEMOS = [
  {
    query: "make a 30s day-in-my-life from these clips",
    plan: ["Order the clips by time of day", "Cut on every bar of the lofi track", "0.5× on the best walking shot", "Warm grade, crossfades, check"],
    tags: ["9:16", "music", "beat cuts"],
    toast: "brief to export: 167s",
  },
  {
    query: "cut the ums and add bold subtitles",
    plan: ["Transcribe every word", "Drop 14 fillers and long pauses", "Karaoke subtitles, misheard words fixed", "Check: no jump cuts on speech"],
    tags: ["talking head", "subtitles"],
    toast: "words timed within 150ms",
  },
  {
    query: "blur everyone in the background",
    plan: ["Track people with SAM 3.1", "Keep the subject sharp", "Blur the rest, frame by frame", "Check: no leaks at the edges"],
    tags: ["privacy", "tracking"],
    toast: "83% subject coverage",
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The agent card, alive: a brief types itself, a plan lands, the top result gets the lime ring, a
 * cursor clicks it and a toast pops, then the next brief. Runs only while on screen.
 */
function AgentDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState(reduce ? DEMOS[0].query : "");
  const [phase, setPhase] = useState<"typing" | "plan" | "picked" | "toast">(reduce ? "toast" : "typing");

  useEffect(() => {
    if (reduce || !inView) return;
    let alive = true;
    (async () => {
      let k = i;
      while (alive) {
        const demo = DEMOS[k];
        setI(k);
        setPhase("typing");
        for (let n = 0; n <= demo.query.length && alive; n++) {
          setTyped(demo.query.slice(0, n));
          await sleep(38);
        }
        await sleep(300);
        if (!alive) return;
        setPhase("plan");
        await sleep(1300);
        if (!alive) return;
        setPhase("picked");
        await sleep(900);
        if (!alive) return;
        setPhase("toast");
        await sleep(2600);
        k = (k + 1) % DEMOS.length;
      }
    })();
    return () => {
      alive = false;
    };
    // Restart only on visibility; the loop owns `i` while it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduce]);

  const demo = DEMOS[i];
  const showPlan = phase !== "typing";

  return (
    <div ref={ref} className="relative" style={{ "--sel": "var(--blue)" } as React.CSSProperties}>
      <div className="pointer-events-none absolute -inset-[10px] z-10 border-[1.5px] border-[var(--sel)]">
        {["-top-[6px] -left-[6px]", "-top-[6px] -right-[6px]", "-bottom-[6px] -left-[6px]", "-right-[6px] -bottom-[6px]"].map((p) => (
          <span key={p} className={`absolute size-[11px] border-2 border-[var(--sel)] bg-white ${p}`} />
        ))}
        <span className="label absolute -top-[26px] left-1/2 -translate-x-1/2 rounded-[4px] bg-[var(--sel)] px-2 py-1 text-[10px] whitespace-nowrap text-paper">agent, run #12</span>
      </div>
      <div className="relative overflow-hidden rounded-[22px] border-2 border-ink bg-white p-4 shadow-[8px_8px_0_var(--ink)] md:p-7">
        <div className="flex items-center gap-3 rounded-full border-2 border-ink/80 bg-white px-4 py-3 md:px-5 md:py-3.5">
          <MagnifyingGlass size={20} weight="bold" className="shrink-0 text-blue" />
          <span className="min-w-0 flex-1 truncate text-[16px] md:text-[19px]">
            {typed}
            {phase === "typing" && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse bg-ink" />}
          </span>
          <span className="hidden rounded-full bg-blue px-4 py-1.5 text-[13px] font-semibold text-white sm:inline">Send</span>
        </div>
        <div className="label mt-3 flex gap-5 border-b border-ink/10 pb-2 text-[11px] text-ink/50">
          <span className="-mb-[10px] border-b-2 border-blue pb-2 text-blue">Plan</span>
          <span>Tools</span>
          <span>Checks</span>
          <span className="hidden sm:inline">Timeline</span>
        </div>

        <div className="relative mt-5 min-h-[360px]">
          <AnimatePresence mode="wait">
            {showPlan && (
              <motion.div key={i} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                <motion.div
                  initial={{ y: 16, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  className="relative rounded-xl p-3 transition-[box-shadow,background-color] duration-500 md:p-4"
                  style={{
                    boxShadow: phase === "plan" ? "none" : "0 0 0 3px var(--lime), 0 0 0 5px var(--ink)",
                    background: phase === "plan" ? "transparent" : "rgb(200 245 60 / 0.18)",
                  }}
                >
                  <p className="label text-[10px] text-ink/50">edit plan · auteur agent</p>
                  <p className="mt-1 text-[18px] font-semibold text-[#1a0dab] md:text-[20px]">{demo.query}</p>
                  <ol className="mt-2 space-y-1 text-[14px] text-ink/80">
                    {demo.plan.map((step, k) => (
                      <motion.li key={step} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + k * 0.08 }} className="flex gap-2.5">
                        <span className="w-5 shrink-0 font-mono text-[11px] text-ink/40">{String(k + 1).padStart(2, "0")}</span>
                        {step}
                      </motion.li>
                    ))}
                  </ol>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {demo.tags.map((t) => (
                      <span key={t} className="rounded-full border border-ink/40 px-2.5 py-0.5 text-[12px]">
                        {t}
                      </span>
                    ))}
                  </div>
                </motion.div>
                {[0.75, 0.5, 0.62].map((w, k) => (
                  <motion.div key={k} initial={{ opacity: 0 }} animate={{ opacity: 0.6 }} transition={{ delay: 0.4 + k * 0.1 }} className="mt-5 space-y-2 px-3 md:px-4">
                    <div className="h-2.5 rounded-full bg-blue/25" style={{ width: `${w * 100}%` }} />
                    <div className="h-2 w-[85%] rounded-full bg-ink/10" />
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {!reduce && (
            <motion.span
              className="pointer-events-none absolute top-0 left-0 z-10 text-ink"
              animate={
                phase === "plan"
                  ? { x: 420, y: 330, opacity: 1, scale: 1 }
                  : phase === "picked"
                    ? { x: 180, y: 40, opacity: 1, scale: [1, 0.8, 1] }
                    : { x: 520, y: 360, opacity: 0 }
              }
              transition={{ duration: 0.8, ease: [0.65, 0, 0.35, 1] }}
            >
              <CursorClick size={28} weight="fill" />
            </motion.span>
          )}
        </div>

        <AnimatePresence>
          {phase === "toast" && (
            <motion.div
              initial={{ y: 40, opacity: 0, scale: 0.8 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
              className="absolute right-5 bottom-5 z-20 flex items-center gap-3 rounded-2xl border-2 border-ink bg-lime px-4 py-3 text-forest shadow-[4px_4px_0_var(--ink)]"
            >
              <span className="display text-[28px] leading-none">+1</span>
              <span className="text-[13px] leading-tight font-semibold">
                keeper
                <br />
                <span className="font-normal opacity-70">{demo.toast}</span>
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** (02) The agent: intent in, a plan out. */
export function AgentSection() {
  return (
    <section id="agent" className="paper-texture relative overflow-hidden bg-paper px-[var(--gutter)] pt-[12vw] pb-[11vw] text-ink">
      <Heading
        kicker="(02) The agent"
        tone="blue"
        title="You write one sentence."
        accent="it writes the plan."
        accentClass="text-blue"
        body="Brief it the way you'd brief a friend who edits. The agent posts its plan before it touches your footage, then runs the tools it needs. Every step shows up in the log, so you can see what it did and why."
      />
      <div className="mt-16 grid gap-14 lg:mt-24 lg:grid-cols-12 lg:gap-12">
        <Fade className="lg:col-span-7">
          <AgentDemo />
        </Fade>
        <div className="lg:col-span-5">
          <ServiceList items={AGENT_TOOLS} prefix="A" label="What it does on its own" line="var(--ink)" hoverBg="var(--blue)" hoverFg="var(--paper)" />
        </div>
      </div>
    </section>
  );
}

const EDITOR_TOOLS = [
  ["Timeline", "B-roll, main, text and music tracks. Drag, trim, split, snap."],
  ["Keyframes", "Speed ramps, volume and framing that change over time."],
  ["Color", "Wheels, curves, LOG profiles and looks. The preview uses the export's color math."],
  ["Subtitles", "Five caption styles; fix any word on the text track."],
  ["History", "Undo a single edit or a whole instruction."],
] as const;

const FEED_COLORS = ["#ffc22e", "#c8f53c", "#2e3bff", "#ff8fcf", "#ff4f1f", "#1d1c1a"];

/**
 * (03) The editor. A phone scrolls its feed as you scroll the page; when our edit reaches the middle a
 * finger taps it, hearts burst and a "checked. shipped." stamp slams down.
 */
export function EditorSection() {
  const root = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce || !root.current) return;
    const ctx = gsap.context(() => {
      const st = { trigger: "[data-phone-zone]", start: "top 85%", end: "bottom 15%", scrub: 1 };
      gsap.fromTo("[data-phone]", { y: 80, rotate: 8 }, { y: -80, rotate: -3, ease: "none", scrollTrigger: st });
      gsap.fromTo("[data-feed]", { yPercent: 0 }, { yPercent: -46, ease: "none", scrollTrigger: { ...st, end: "center 45%" } });
      gsap.from("[data-bubble]", { y: 20, scale: 0.6, opacity: 0, stagger: 0.25, duration: 0.6, ease: "back.out(2)", scrollTrigger: { trigger: "[data-phone-zone]", start: "top 60%" } });
      const tap = gsap.timeline({ paused: true });
      tap
        .fromTo("[data-touch]", { scale: 1.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25 })
        .to("[data-touch]", { scale: 0.8, opacity: 0, duration: 0.3 })
        .fromTo(
          "[data-heart]",
          { y: 0, x: 0, opacity: 1, scale: 0.4 },
          { y: () => gsap.utils.random(-170, -90), x: () => gsap.utils.random(-70, 70), rotate: () => gsap.utils.random(-40, 40), scale: 1, opacity: 0, duration: 1, stagger: 0.04, ease: "power2.out" },
          "<",
        )
        .fromTo("[data-stamp]", { scale: 2.4, rotate: -30, opacity: 0 }, { scale: 1, rotate: -12, opacity: 1, duration: 0.45, ease: "back.out(2.5)" }, "-=0.8");
      ScrollTrigger.create({ trigger: "[data-phone-zone]", start: "center 55%", onEnter: () => tap.play(0), onLeaveBack: () => tap.reverse() });
    }, root);
    return () => ctx.revert();
  }, [reduce]);

  return (
    <section ref={root} className="paper-texture relative overflow-hidden bg-blue px-[var(--gutter)] pt-[12vw] pb-[12vw] text-paper [--texture-strength:0.3]">
      <Heading
        kicker="(03) The editor"
        tone="paper"
        title="The edit lands on a timeline."
        accent="move anything."
        accentClass="text-pink"
        body="Most AI video apps hand you a finished file. Auteur hands you four tracks you can drag, trim and split, and each agent instruction undoes in one click."
        dark
      />
      <div className="mt-16 grid items-center gap-16 lg:mt-24 lg:grid-cols-12">
        <div className="order-2 lg:order-1 lg:col-span-6">
          <ServiceList items={EDITOR_TOOLS} prefix="E" label="What you can change" line="var(--paper)" hoverBg="var(--pink)" hoverFg="var(--ink)" dark />
        </div>
        <div data-phone-zone className="order-1 flex justify-center lg:order-2 lg:col-span-6">
          <div data-phone className="relative will-change-transform">
            <div data-bubble className="absolute top-[16%] -left-[10%] z-20 rounded-2xl rounded-br-sm border-2 border-ink bg-paper px-4 py-2.5 text-[14px] font-medium text-ink">
              warmer, <span className="text-tomato">please</span>
            </div>
            <div data-bubble className="absolute top-[44%] -right-[10%] z-20 rounded-2xl rounded-bl-sm border-2 border-ink bg-pink px-4 py-2.5 text-[14px] font-medium text-ink">
              cut on the drop
            </div>
            <div data-bubble className="absolute bottom-[16%] -left-[8%] z-20 rounded-2xl rounded-br-sm border-2 border-ink bg-lime px-4 py-2.5 text-[14px] font-medium text-ink">
              undo that one
            </div>

            <div className="relative h-[560px] w-[272px] rounded-[46px] border-[10px] border-ink bg-ink shadow-[14px_14px_0_rgb(18_17_16/0.35)] md:h-[640px] md:w-[310px]">
              <div className="relative h-full w-full overflow-hidden rounded-[36px] bg-white">
                <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-white px-5 pt-8 pb-2 text-ink">
                  <span className="text-[17px] font-bold tracking-[-0.02em]">For you</span>
                  <Heart size={20} />
                </div>
                <div data-feed className="absolute inset-x-0 top-0 flex flex-col gap-3 px-3 pt-[72px] will-change-transform">
                  {Array.from({ length: 13 }, (_, k) =>
                    k === 6 ? (
                      <div key={k} className="shrink-0 rounded-2xl border-2 border-ink bg-white p-2.5 text-ink">
                        <div className="flex items-center gap-2">
                          <span className="display grid size-7 place-items-center rounded-full bg-lime text-[12px]">au</span>
                          <span className="text-[12px] leading-tight font-semibold">
                            your cut
                            <span className="block font-normal text-ink/50">made with auteur</span>
                          </span>
                        </div>
                        <div className="relative mt-2 aspect-[4/5] overflow-hidden rounded-xl border-2 border-ink">
                          <Image src="/assets/hero-3.webp" alt="An Auteur edit in a social feed" fill sizes="300px" className="object-cover" />
                          <p className="absolute inset-x-0 bottom-4 px-3 text-center font-[Montserrat] text-[20px] font-black text-paper uppercase [text-shadow:0_2px_0_#000]">
                            we <span className="text-lime">finally</span> made it
                          </p>
                        </div>
                        <div className="mt-2 flex items-center justify-between rounded-lg bg-ink px-3 py-2 text-[12px] font-semibold text-paper">
                          Export · 9:16 · 30 fps <ArrowUpRight size={12} weight="bold" />
                        </div>
                      </div>
                    ) : (
                      <div key={k} className="shrink-0 rounded-2xl border border-ink/10 bg-white p-2.5">
                        <div className="flex items-center gap-2">
                          <span className="size-7 rounded-full bg-ink/10" />
                          <span className="h-2 w-24 rounded-full bg-ink/10" />
                        </div>
                        <div className="mt-2 aspect-[4/3] rounded-xl" style={{ background: FEED_COLORS[k % FEED_COLORS.length], opacity: 0.35 }} />
                      </div>
                    ),
                  )}
                </div>
                <div data-touch className="pointer-events-none absolute bottom-[30%] left-1/2 z-20 -ml-7 size-14 rounded-full border-2 border-ink/40 bg-ink/15 opacity-0" />
              </div>
              <div className="absolute top-[6px] left-1/2 z-20 h-[22px] w-[92px] -translate-x-1/2 rounded-full bg-ink" />
              <div className="pointer-events-none absolute bottom-[34%] left-1/2 z-30">
                {Array.from({ length: 8 }, (_, k) => (
                  <Heart key={k} data-heart size={30} weight="fill" className={`absolute -ml-4 opacity-0 ${k % 2 ? "text-pink" : "text-tomato"}`} />
                ))}
              </div>
              <div
                data-stamp
                className="absolute top-[6%] -right-[8%] z-30 grid size-[112px] place-items-center rounded-full border-[3px] border-ink bg-lime text-center text-forest opacity-0 md:top-[8%] md:-right-[18%]"
              >
                <div>
                  <Sparkle size={18} weight="fill" className="mx-auto mb-1 text-tomato" />
                  <div className="display text-[25px] leading-[0.88]">
                    checked.
                    <br />
                    exported.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
