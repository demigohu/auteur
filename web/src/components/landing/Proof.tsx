"use client";

import { Check, FileVideo, Plus, Sparkle, Waveform, X } from "@phosphor-icons/react";
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Kicker } from "./primitives";
import { Heading } from "./Product";
import { Fade, RevealLines } from "./reveal";

gsap.registerPlugin(ScrollTrigger);

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

function CountUp({ to, decimals = 0, prefix = "", suffix = "" }: { to: number; decimals?: number; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!inView || !ref.current) return;
    const el = ref.current;
    const c = animate(reduce ? to : 0, to, { duration: 1.4, ease: EASE_OUT, onUpdate: (v) => (el.textContent = `${prefix}${v.toFixed(decimals)}${suffix}`) });
    return () => c.stop();
  }, [inView, to, decimals, prefix, suffix, reduce]);
  return (
    <span ref={ref}>
      {prefix}
      {to.toFixed(decimals)}
      {suffix}
    </span>
  );
}

const STATS = [
  { label: "Subjects tracked by SAM 3.1", to: 83, suffix: "%" },
  { label: "Words timed within 150ms", to: 86, suffix: "%" },
  { label: "Agent tools", to: 19, suffix: "" },
  { label: "Cost of a full 30s edit", to: 0.53, prefix: "$", decimals: 2 },
  { label: "Brief to export, in seconds", to: 167, suffix: "" },
];

/** (05) The render log: measured numbers, and a printed log of the run. */
export function Receipts() {
  const reduce = useReducedMotion();
  return (
    <section className="paper-texture relative overflow-hidden bg-tomato px-[var(--gutter)] py-[clamp(120px,18vh,200px)] text-ink [--texture-strength:0.7]">
      <div className="mx-auto grid max-w-[1400px] gap-16 lg:grid-cols-[1fr_minmax(0,22rem)]">
        <div>
          <Fade>
            <Kicker tone="ink">(05) Render log</Kicker>
          </Fade>
          <RevealLines
            className="mt-6 text-[clamp(64px,10vw,180px)] leading-[0.84]"
            lines={[
              { text: "The render log.", className: "display" },
              { text: "every number measured.", className: "font-serif italic normal-case text-paper pb-[0.04em]" },
            ]}
          />
          <p className="mt-6 max-w-[44ch] text-[17px] leading-relaxed text-ink/85">
            Measured on our own test footage and fixtures. The scripts that produced them are in the repo.
          </p>
          <dl className="mt-14 grid gap-x-10 sm:grid-cols-2 lg:max-w-[760px]">
            {STATS.map((s) => (
              <div key={s.label} className="border-t-2 border-ink py-5">
                <dt className="label text-[10px] text-ink/70">{s.label}</dt>
                <dd className="display mt-2 text-[clamp(56px,6vw,96px)]">
                  <CountUp to={s.to} decimals={s.decimals} prefix={s.prefix} suffix={s.suffix} />
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative pt-4 lg:pt-28">
          <div className="relative z-10 h-4 rounded-full bg-ink" />
          {/* The trigger sits on the unclipped wrapper: the receipt itself starts hidden inside the
              slot, where an IntersectionObserver would never see it. */}
          <motion.div initial={reduce ? false : "hidden"} whileInView="printed" viewport={{ once: true, amount: 0.3 }} className="-mt-2 overflow-hidden px-3">
            <motion.div
              variants={{ hidden: { y: "-100%" }, printed: { y: 0 } }}
              transition={{ duration: 1.6, ease: [0.45, 0, 0.2, 1] }}
              className="bg-[#fbf9f4] px-6 pt-8 pb-10 font-mono text-[12px] text-ink shadow-[0_20px_40px_rgba(0,0,0,0.25)] [clip-path:polygon(0_0,100%_0,100%_100%,95%_97%,90%_100%,85%_97%,80%_100%,75%_97%,70%_100%,65%_97%,60%_100%,55%_97%,50%_100%,45%_97%,40%_100%,35%_97%,30%_100%,25%_97%,20%_100%,15%_97%,10%_100%,5%_97%,0_100%)]"
            >
              <p className="text-center tracking-[0.2em]">AUTEUR · RENDER LOG</p>
              <p className="mt-1 text-center text-ink/50">run #12 · 9:16 · 30 fps</p>
              <div className="my-4 border-t border-dashed border-ink/40" />
              {[
                ["SCRUBBING", "0:00"],
                ["RE-EXPORTS", "0"],
                ["UMS LEFT IN", "0"],
                ["CUTS OFF THE BEAT", "0"],
                ["COFFEE", "1.00"],
              ].map(([k, v]) => (
                <p key={k} className="flex justify-between gap-2">
                  <span>{k}</span>
                  <span className="flex-1 overflow-hidden whitespace-nowrap text-ink/30">{"·".repeat(40)}</span>
                  <span>{v}</span>
                </p>
              ))}
              <div className="my-4 border-t border-dashed border-ink/40" />
              <p className="flex items-baseline justify-between">
                <span>TOTAL</span>
                <span className="display text-[24px]">one 30s video</span>
              </p>
              <div className="mt-6 flex h-12 items-stretch justify-center gap-[2px]" aria-hidden>
                {Array.from({ length: 46 }, (_, i) => (
                  <span key={i} className="bg-ink" style={{ width: [1, 2, 1, 3, 1, 2][i % 6] }} />
                ))}
              </div>
              <p className="mt-4 text-center font-hand text-[20px]">see you next shoot</p>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

const TOOLKIT = [
  {
    name: "Color grading",
    color: "#ff4f1f",
    ink: "#121110",
    body: "Auto exposure and white balance, eight looks, shot matching across clips, and real LOG profiles. The preview runs the same curve as the export.",
    chips: ["Apple Log", "S-Log3", "V-Log", "Shot matching", "Wheels + curves"],
  },
  {
    name: "Subtitles",
    color: "#ff8fcf",
    ink: "#121110",
    body: "Word-timed captions in five creator styles, misheard words fixed from context, and karaoke highlights that land on the syllable.",
    chips: ["Karaoke", "Box", "Bold", "Pop", "Clean"],
  },
  {
    name: "Music & beats",
    color: "#ffc22e",
    ink: "#121110",
    body: "Bring your own track. Beats are detected, cuts snap to the bar, and the music ducks under speech by itself.",
    chips: ["Beat detection", "Cut on beat", "Ducking", "Fades"],
  },
  {
    name: "Tracking & privacy",
    color: "#c8f53c",
    ink: "#0e3a22",
    body: "SAM 3.1 tracks people, faces and plates. Blur the strangers, highlight the subject, keep the one who matters sharp.",
    chips: ["SAM 3.1", "Blur", "Highlight", "Exclude IDs"],
  },
  {
    name: "Reframe & export",
    color: "#2e3bff",
    ink: "#f2eee3",
    body: "One timeline, three formats. The crop follows the subject with keyframes you can edit, then exports at 24, 30 or 60 fps.",
    chips: ["16:9", "9:16", "1:1", "Follow subject", "Keyframes"],
  },
];

/** (06) The toolkit: a vertical title and color-banded rows that open one at a time. */
export function Toolkit() {
  const [open, setOpen] = useState(0);
  return (
    <section className="grid bg-ink text-paper lg:grid-cols-[minmax(0,14rem)_1fr]">
      <div className="flex items-center justify-center px-[var(--gutter)] py-16 lg:py-0">
        <h2 className="display text-[clamp(64px,7vw,110px)] leading-[0.85] lg:-rotate-90 lg:whitespace-nowrap">
          The full <span className="text-lime">toolkit</span>
        </h2>
      </div>
      <div>
        <div className="px-[var(--gutter)] py-14 lg:px-12">
          <Kicker tone="paper">(06) The toolkit</Kicker>
          <p className="mt-5 max-w-[50ch] text-[17px] leading-relaxed text-paper/75">
            Cutting is half the job. These finish the other half, and the agent reaches for them on its own.
          </p>
        </div>
        <ul>
          {TOOLKIT.map((t, i) => {
            const isOpen = open === i;
            return (
              <li key={t.name} style={{ background: t.color, color: t.ink }} className="border-t-2 border-ink">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  className="flex w-full items-center gap-5 px-[var(--gutter)] py-5 text-left lg:px-12"
                >
                  <span className="label w-8 text-[10px] opacity-60">{String(i + 1).padStart(2, "0")}</span>
                  <span className="display flex-1 text-[clamp(40px,5vw,76px)] transition-transform duration-500 ease-[var(--ease-out)] hover:translate-x-2">{t.name}</span>
                  <span className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-current">
                    {isOpen ? <X size={16} weight="bold" /> : <Plus size={16} weight="bold" />}
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.45, ease: EASE_OUT }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-wrap items-end justify-between gap-6 px-[var(--gutter)] pb-7 pl-[calc(var(--gutter)+3.25rem)] lg:px-12 lg:pl-[6.25rem]">
                        <p className="max-w-[56ch] text-[16px] leading-relaxed opacity-90">{t.body}</p>
                        <div className="flex max-w-[26rem] flex-wrap justify-end gap-2">
                          {t.chips.map((c) => (
                            <span key={c} className="rounded-full border-2 border-current px-3 py-1 text-[12px] font-semibold">
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

const STEPS = [
  { n: "01", title: "Drop", sub: "Upload", body: "Clips straight off the phone or camera, LOG or not, plus a song if you have one.", chips: ["MP4 · MOV", "Up to 5 min", "MP3 · WAV"], color: "#ff4f1f", art: "files" },
  { n: "02", title: "Brief", sub: "Say what you want", body: "One or two sentences, like you'd tell an editor. The agent writes a plan you can read before it touches anything.", chips: ["Plain words", "Any language", "Recipes"], color: "#2e3bff", art: "notes" },
  { n: "03", title: "Watch", sub: "Look & listen", body: "Muse Spark watches sampled frames, Voice transcribes every word, SAM 3.1 tracks who matters.", chips: ["Muse Spark", "Voice", "SAM 3.1"], color: "#ff8fcf", art: "wave" },
  { n: "04", title: "Cut", sub: "Build the timeline", body: "Clips ordered, trimmed, synced to the beat, graded and captioned, all as ordinary edits on a timeline.", chips: ["Beat cuts", "Grade", "Captions"], color: "#ffc22e", art: "timeline" },
  { n: "05", title: "Check", sub: "Verify & export", body: "A checker outside the agent's control renders and inspects the cut. Problems go back to the agent, then it exports.", chips: ["Subject in frame", "No leaks", "On the beat"], color: "#c8f53c", art: "checks" },
] as const;

function StepArt({ kind }: { kind: (typeof STEPS)[number]["art"] }) {
  if (kind === "files")
    return (
      <div className="relative h-44 w-56">
        {[-10, 4, 14].map((r, i) => (
          <div key={r} className="absolute inset-x-4 top-4 flex h-32 items-end rounded-[12px] border-2 border-ink bg-paper p-3 shadow-[0_4px_0_0_var(--ink)]" style={{ transform: `rotate(${r}deg) translateY(${i * 6}px)` }}>
            <FileVideo size={26} />
            <span className="ml-2 font-mono text-[11px]">clip_0{i + 1}.mov</span>
          </div>
        ))}
      </div>
    );
  if (kind === "notes")
    return (
      <div className="grid grid-cols-2 gap-3">
        {[
          ["Order by time", "#ffc22e", -6],
          ["Cut on beat", "#ff8fcf", 5],
          ["Warm grade", "#c8f53c", 3],
          ["30 seconds", "#f2eee3", -4],
        ].map(([t, c, r]) => (
          <div key={t as string} className="display grid size-28 place-items-center border-2 border-ink p-2 text-center text-[22px] leading-[0.9] text-ink shadow-[0_4px_0_0_var(--ink)]" style={{ background: c as string, transform: `rotate(${r}deg)` }}>
            {t}
          </div>
        ))}
      </div>
    );
  if (kind === "wave")
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-24 items-center gap-1.5">
          {[0.3, 0.7, 1, 0.5, 0.85, 0.4, 0.95, 0.6, 0.3, 0.75, 1, 0.45, 0.65, 0.35].map((h, i) => (
            <span key={i} className="w-2.5 rounded-full border-2 border-ink bg-paper" style={{ height: `${h * 100}%` }} />
          ))}
        </div>
        <span className="flex items-center gap-2 rounded-full border-2 border-ink bg-paper px-4 py-1.5 font-mono text-[12px]">
          <Waveform size={14} /> &ldquo;so, today we&apos;re…&rdquo;
        </span>
      </div>
    );
  if (kind === "timeline")
    return (
      <div className="w-64 space-y-2 rounded-[14px] border-2 border-ink bg-ink p-3">
        {[
          [["#ff4f1f", 30], ["#2e3bff", 25], ["#c8f53c", 45]],
          [["#ff8fcf", 60], ["#f2eee3", 40]],
          [["#ffc22e", 100]],
        ].map((row, i) => (
          <div key={i} className="flex gap-1">
            {row.map(([c, w], k) => (
              <span key={k} className="h-7 rounded-[5px] border border-ink" style={{ background: c as string, width: `${w}%` }} />
            ))}
          </div>
        ))}
        <span className="relative ml-[58%] block h-2 w-[2px] bg-lime" />
      </div>
    );
  return (
    <div className="w-60 rounded-[14px] border-2 border-ink bg-paper p-4 shadow-[0_5px_0_0_var(--ink)]">
      <p className="label text-[9px] text-ink/50">Checker</p>
      {["Subject in frame", "Blur holds", "Cuts on beat", "Length 30s", "Colors match"].map((t) => (
        <p key={t} className="mt-2 flex items-center gap-2 text-[13px] font-medium text-ink">
          <span className="grid size-4 place-items-center rounded-[4px] bg-forest text-lime">
            <Check size={10} weight="bold" />
          </span>
          {t}
        </p>
      ))}
    </div>
  );
}

/**
 * (07) How it works: five cards that pin and stack. Each card is paper inside a thick colored frame;
 * as the next one slides over it, it shrinks a little from the top and dims, and each card's art
 * rises in as it arrives.
 */
export function Process() {
  const root = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce || !root.current) return;
    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray<HTMLElement>("[data-pcard]");
      cards.forEach((card, i) => {
        gsap.fromTo(
          card.querySelector("[data-part]"),
          { y: 60, rotate: gsap.utils.random(-4, 4), opacity: 0 },
          { y: 0, rotate: 0, opacity: 1, duration: 0.9, ease: "back.out(1.6)", scrollTrigger: { trigger: card, start: "top 70%" } },
        );
        const next = cards[i + 1];
        if (!next) return;
        const st = { trigger: next, start: "top bottom", end: "top 20%", scrub: true };
        gsap.to(card.querySelector("[data-pinner]"), { scale: 0.92, ease: "none", scrollTrigger: st });
        gsap.to(card.querySelector("[data-pshade]"), { opacity: 0.22, ease: "none", scrollTrigger: st });
      });
    }, root);
    return () => ctx.revert();
  }, [reduce]);

  return (
    <section ref={root} id="process" className="paper-texture relative bg-paper px-[var(--gutter)] pt-[12vw] pb-[8vw] text-ink">
      <Heading
        kicker="(07) How it works"
        tone="ink"
        title="How a brief"
        accent="becomes a video."
        accentClass="text-tomato"
        body="You can read the plan before anything changes, and undo any instruction afterwards."
      />

      <div className="mt-16 md:mt-24">
        {STEPS.map((s, i) => (
          <div key={s.n} data-pcard className="relative mb-6 md:sticky md:mb-[6vh]" style={{ top: `calc(90px + ${i * 22}px)` }}>
            <div
              data-pinner
              className="relative grid origin-top overflow-hidden rounded-[30px] border-[3px] border-ink bg-paper shadow-[0_24px_60px_-20px_rgb(18_17_16/0.45)] will-change-transform md:grid-cols-2"
              style={{ outline: `14px solid ${s.color}`, outlineOffset: "-17px" }}
            >
              <div className="flex flex-col justify-between gap-8 p-8 md:p-12">
                <div className="flex items-start justify-between">
                  <span className="display text-[clamp(80px,9vw,150px)] leading-[0.8] text-transparent [-webkit-text-stroke:2.5px_var(--ink)]">{s.n}</span>
                  <span className="label mt-2 text-[11px] text-ink/60">
                    step {i + 1} of {STEPS.length}
                  </span>
                </div>
                <div>
                  <h3 className="display text-[clamp(64px,8vw,140px)] leading-[0.82]">{s.title}</h3>
                  <p className="mt-1 font-serif text-[clamp(26px,2.6vw,40px)] italic text-ink/70">{s.sub}</p>
                  <p className="mt-5 max-w-[440px] text-[18px] leading-[1.45]">{s.body}</p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {s.chips.map((c) => (
                      <span key={c} className="rounded-full border-2 border-ink px-3 py-1 text-[13px] font-semibold">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="relative min-h-[320px] overflow-hidden border-t-[3px] border-ink md:border-t-0 md:border-l-[3px]" style={{ background: s.color }}>
                <div className="absolute inset-0 grid place-items-center">
                  <div data-part>
                    <StepArt kind={s.art} />
                  </div>
                </div>
                {i === STEPS.length - 1 && (
                  <span className="absolute top-8 right-8 grid size-20 rotate-12 place-items-center rounded-full border-2 border-ink bg-tomato text-ink">
                    <Sparkle size={30} weight="fill" />
                  </span>
                )}
              </div>
              <div data-pshade className="pointer-events-none absolute inset-0 bg-ink opacity-0" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
