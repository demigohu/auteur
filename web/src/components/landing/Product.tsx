"use client";

import { ArrowRight, MagnifyingGlass, Sparkle } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { Kicker } from "./primitives";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

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

const AGENT_TOOLS = [
  ["Watch", "Muse Spark looks at sampled frames: who's in shot, what's happening, which moments are alive."],
  ["Listen", "Word-level transcript for subtitles, and for finding the ums worth cutting."],
  ["Track", "SAM 3.1 follows a person, a face or a plate through every frame."],
  ["Reframe", "Vertical and square versions that keep the subject in frame."],
  ["Grade", "Exposure and white balance fixed, a look applied, every clip matched."],
] as const;

function Heading(props: { kicker: string; tone: "blue" | "tomato" | "forest" | "lime" | "ink" | "paper"; title: string; accent: string; accentClass: string; body: string; dark?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <div className="grid items-end gap-8 lg:grid-cols-[1fr_minmax(0,24rem)]">
      <div>
        <Kicker tone={props.tone}>{props.kicker}</Kicker>
        <motion.h2
          initial={reduce ? false : { opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.9, ease: EASE_OUT }}
          className="display mt-6 text-[clamp(60px,9vw,150px)]"
        >
          {props.title}
        </motion.h2>
        <motion.p
          initial={reduce ? false : { opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ delay: 0.1, duration: 0.9, ease: EASE_OUT }}
          className={`pb-2 font-serif text-[clamp(52px,7.4vw,124px)] leading-[0.95] italic ${props.accentClass}`}
        >
          {props.accent}
        </motion.p>
      </div>
      <p className={`max-w-[38ch] text-[17px] leading-relaxed ${props.dark ? "text-paper/85" : "text-ink/75"}`}>{props.body}</p>
    </div>
  );
}

function ToolList({ items, prefix, label, dark }: { items: readonly (readonly [string, string])[]; prefix: string; label: string; dark?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <div>
      <p className={`label text-[10px] ${dark ? "text-paper/60" : "text-ink/50"}`}>{label}</p>
      <ol className={`mt-4 border-t-2 ${dark ? "border-paper" : "border-ink"}`}>
        {items.map(([name, line], i) => (
          <motion.li
            key={name}
            initial={reduce ? false : { opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ delay: i * 0.06, duration: 0.7, ease: EASE_OUT }}
            className={`group grid grid-cols-[3.5rem_1fr] items-start gap-3 border-b-2 py-5 ${dark ? "border-paper" : "border-ink"}`}
          >
            <span className={`label pt-3 text-[10px] ${dark ? "text-paper/50" : "text-ink/45"}`}>
              {prefix}/{String(i + 1).padStart(2, "0")}
            </span>
            <span>
              <span className="display block text-[clamp(36px,3.6vw,56px)] transition-transform duration-500 ease-[var(--ease-out)] group-hover:translate-x-2">{name}</span>
              <span className={`mt-1 block max-w-[46ch] text-[14px] leading-snug ${dark ? "text-paper/75" : "text-ink/65"}`}>{line}</span>
            </span>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

/** (02) The agent: a brief goes in, a plan comes out, on a search-results-style card. */
export function AgentSection() {
  const reduce = useReducedMotion();
  return (
    <section id="agent" className="paper-texture bg-paper px-[var(--gutter)] pt-[clamp(140px,20vh,220px)] pb-[clamp(110px,16vh,180px)] text-ink">
      <div className="mx-auto max-w-[1400px]">
        <Heading
          kicker="(02) The agent · intent"
          tone="blue"
          title="Tell it once."
          accent="it does the rest."
          accentClass="text-blue"
          body="You already know what you want. Say it like you would to an editor. The agent plans the cut, uses the tools it needs, and hands back a timeline, not a black box."
        />

        <div className="mt-20 grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 60, rotate: -2 }}
            whileInView={{ opacity: 1, y: 0, rotate: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 1, ease: EASE_OUT }}
            className="relative"
          >
            <span className="label absolute -top-3 left-1/2 z-10 -translate-x-1/2 rounded-[3px] bg-blue px-2 py-0.5 text-[9px] text-paper">Agent, run #12</span>
            {/* Selection handles, as if the card were picked on a canvas. */}
            <div className="pointer-events-none absolute -inset-3 border border-blue">
              {["-top-1 -left-1", "-top-1 -right-1", "-bottom-1 -left-1", "-bottom-1 -right-1"].map((p) => (
                <span key={p} className={`absolute size-2 border border-blue bg-paper ${p}`} />
              ))}
            </div>
            <div className="rounded-[18px] border-2 border-ink bg-[#fbf9f4] p-5 shadow-[8px_8px_0_0_var(--ink)]">
              <div className="flex items-center gap-3 rounded-full border-2 border-ink px-4 py-2.5">
                <MagnifyingGlass size={18} className="text-blue" />
                <span className="flex-1 truncate text-[15px]">make a 30s day-in-my-life from these clips</span>
                <span className="rounded-full bg-blue px-3 py-1 text-[12px] font-semibold text-paper">Send</span>
              </div>
              <div className="label mt-4 flex gap-5 border-b border-ink/10 pb-2 text-[9px] text-ink/50">
                <span className="text-blue underline decoration-2 underline-offset-[6px]">Plan</span>
                <span>Tools</span>
                <span>Checks</span>
                <span>Timeline</span>
              </div>
              <div className="mt-4 rounded-[12px] border-2 border-lime bg-lime/15 p-4">
                <p className="label text-[9px] text-ink/60">Edit plan</p>
                <ol className="mt-2 space-y-1.5 text-[14px]">
                  {[
                    "Watch all clips, order them by time of day",
                    "Cut on every bar of the lofi track (120 BPM)",
                    "0.5× on the best walking shot (60 fps source)",
                    "Crossfades, slow zoom on the stage, warm grade",
                    "Check: subject in frame, cuts on beat, 30s",
                  ].map((step, i) => (
                    <li key={step} className="flex gap-2.5">
                      <span className="w-5 shrink-0 font-mono text-[11px] text-ink/40">{String(i + 1).padStart(2, "0")}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {["9:16", "music", "beat cuts", "slow-mo"].map((t) => (
                    <span key={t} className="rounded-full border border-ink/40 px-2 py-0.5 text-[11px]">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-4 space-y-2.5">
                {[0.8, 0.55, 0.7].map((w, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="size-6 rounded-full bg-ink/10" />
                    <span className="h-2 rounded-full bg-blue/20" style={{ width: `${w * 100}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <span className="inline-flex items-center gap-2 rounded-[10px] border-2 border-ink bg-lime px-3 py-1.5 text-[12px] font-semibold">
                  <span className="display text-[20px]">167s</span> start to export · $0.53
                </span>
              </div>
            </div>
          </motion.div>

          <ToolList items={AGENT_TOOLS} prefix="A" label="What it does on its own" />
        </div>
      </div>
    </section>
  );
}

const EDITOR_TOOLS = [
  ["Timeline", "Four tracks: B-roll, main, text, music. Drag, trim, split, snap."],
  ["Keyframes", "Speed ramps, volume and framing that move over time."],
  ["Color", "Wheels, curves, LOG profiles and looks, previewed exactly as exported."],
  ["Undo a run", "Every agent instruction is one step back in the history."],
] as const;

/** (03) The editor: the timeline stays yours, shown on a phone mid-edit. */
export function EditorSection() {
  const reduce = useReducedMotion();
  return (
    <section className="paper-texture bg-blue px-[var(--gutter)] py-[clamp(120px,18vh,200px)] text-paper [--texture-strength:0.6]">
      <div className="mx-auto max-w-[1400px]">
        <Heading
          kicker="(03) The editor · control"
          tone="paper"
          title="Every cut"
          accent="stays yours."
          accentClass="text-pink"
          body="Nobody wants a video they can't touch. Whatever the agent builds lands on a real timeline: move a clip, nudge a keyframe, or tell it to try again."
          dark
        />
        <div className="mt-20 grid gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center">
          <ToolList items={EDITOR_TOOLS} prefix="E" label="What you can change" dark />

          <div className="relative mx-auto w-full max-w-[320px]">
            <motion.span
              initial={reduce ? false : { opacity: 0, x: -30, rotate: -12 }}
              whileInView={{ opacity: 1, x: 0, rotate: -6 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3, duration: 0.7, ease: EASE_OUT }}
              className="absolute top-24 -left-24 z-10 rounded-[10px] border-2 border-ink bg-paper px-3 py-1.5 text-[13px] text-ink shadow-[0_3px_0_0_var(--ink)]"
            >
              make it warmer. <span className="text-tomato">now.</span>
            </motion.span>
            <motion.span
              initial={reduce ? false : { opacity: 0, x: 30, rotate: 10 }}
              whileInView={{ opacity: 1, x: 0, rotate: 5 }}
              viewport={{ once: true }}
              transition={{ delay: 0.5, duration: 0.7, ease: EASE_OUT }}
              className="absolute -right-16 bottom-36 z-10 rounded-[10px] border-2 border-ink bg-pink px-3 py-1.5 text-[13px] text-ink shadow-[0_3px_0_0_var(--ink)]"
            >
              cut on the drop??
            </motion.span>
            <motion.span
              initial={reduce ? false : { scale: 0, rotate: -30 }}
              whileInView={{ scale: 1, rotate: -12 }}
              viewport={{ once: true }}
              transition={{ delay: 0.7, duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
              className="display absolute top-16 -right-10 z-10 grid size-28 place-items-center rounded-full border-2 border-ink bg-lime text-center text-[22px] leading-[0.9] text-forest"
            >
              Checked.
              <br />
              Shipped.
            </motion.span>

            <motion.div
              initial={reduce ? false : { y: 80, rotate: 6, opacity: 0 }}
              whileInView={{ y: 0, rotate: 0, opacity: 1 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 1, ease: EASE_OUT }}
              className="rounded-[40px] border-[3px] border-ink bg-ink p-3 shadow-[12px_14px_0_0_rgba(18,17,16,0.4)]"
            >
              <div className="overflow-hidden rounded-[30px] bg-paper text-ink">
                <div className="flex items-center justify-between px-5 pt-3 pb-2 text-[12px] font-semibold">
                  <span>9:41</span>
                  <span className="h-5 w-20 rounded-full bg-ink" />
                  <span>100%</span>
                </div>
                <div className="relative aspect-[9/12] overflow-hidden">
                  <Image src="/assets/phone-reel.jpg" alt="A vertical edit in the Auteur preview" fill sizes="320px" className="object-cover" />
                  <p className="absolute inset-x-0 bottom-6 px-4 text-center font-[Montserrat] text-[22px] font-black text-paper uppercase [text-shadow:0_2px_0_#000]">
                    we <span className="text-lime">finally</span> made it
                  </p>
                </div>
                <div className="space-y-1.5 p-3">
                  {[["bg-tomato", "w-[38%]", "bg-blue", "w-[30%]", "bg-sun", "w-[24%]"]].map((row, k) => (
                    <div key={k} className="flex gap-1">
                      <span className={`h-6 rounded-[4px] border border-ink ${row[0]} ${row[1]}`} />
                      <span className={`h-6 rounded-[4px] border border-ink ${row[2]} ${row[3]}`} />
                      <span className={`h-6 rounded-[4px] border border-ink ${row[4]} ${row[5]}`} />
                    </div>
                  ))}
                  <div className="h-3 rounded-[3px] bg-lime/60" />
                  <div className="flex items-center justify-between pt-1">
                    <span className="label text-[9px] text-ink/50">00:00:12 / 00:00:30</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold text-paper">
                      Export <ArrowRight size={11} weight="bold" />
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
