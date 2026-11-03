"use client";

import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Chips } from "@/components/ui/form";
import { Logo } from "@/components/ui/Logo";
import { RainbowArcs } from "@/components/ui/RainbowArcs";
import { useExperience } from "./experience";
import { Kicker, PillButton } from "./primitives";
import { RevealLines } from "./reveal";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

function Squiggle({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 40 20" className={`absolute w-9 text-tomato ${className}`} aria-hidden>
      <path d="M2 14 L10 4 L18 14 L26 4 L34 14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** (08) In the agent's words: the actual closing message from the day-in-my-life run. */
export function AgentNote() {
  const reduce = useReducedMotion();
  return (
    <section className="paper-texture relative overflow-hidden bg-pink px-[var(--gutter)] py-[clamp(120px,18vh,200px)] text-ink [--texture-strength:0.7]">
      <Squiggle className="top-[14%] left-[8%] rotate-12" />
      <Squiggle className="top-[22%] right-[12%] -rotate-12" />
      <Squiggle className="bottom-[18%] left-[16%] rotate-45" />
      <Squiggle className="right-[22%] bottom-[12%] -rotate-6" />
      <div className="mx-auto max-w-[1100px] text-center">
        <Kicker tone="ink">(08) From the agent</Kicker>
        <motion.blockquote
          initial={reduce ? false : { opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.9, ease: EASE_OUT }}
          className="mt-10 font-hand text-[clamp(36px,4.6vw,68px)] leading-[1.1] font-semibold"
        >
          &ldquo;done. day in my life, vertical, about thirty seconds: night walk, the crowd, the band, everyone singing. lofi at 120 bpm,{" "}
          <span className="underline decoration-tomato decoration-4 underline-offset-8">cuts on every bar</span>. i dropped the letterbox, it only made a vertical
          frame smaller.&rdquo;
        </motion.blockquote>
        <div className="mt-10 inline-flex items-center gap-3 text-left">
          <span className="display grid size-12 place-items-center rounded-full border-2 border-ink bg-sun text-[18px]">Au</span>
          <span>
            <span className="block text-[15px] font-semibold">Auteur agent</span>
            <span className="block text-[13px] text-ink/65">Run #12 · 167 seconds · $0.53 · translated from Indonesian</span>
          </span>
        </div>
      </div>
    </section>
  );
}

const FAQ = [
  ["Do I need to know how to edit?", "No. Describe the video you want. If you do know how, every cut is on a normal timeline you can change by hand."],
  ["What footage works best?", "Phone or camera clips up to five minutes in total. 16:9 gives the reframe room to move; LOG footage is graded properly."],
  ["Does it really watch the video?", "Yes. Muse Spark looks at sampled frames, Voice Transcribe hears every word, and SAM 3.1 tracks people and objects frame by frame."],
  ["Can I undo what the agent did?", "Every instruction is one entry in the history. Undo the whole run in one click, or single edits inside it."],
  ["Is the preview what I'll export?", "Yes. The preview uses the same color curve, the same subtitle renderer and the same timing as the export."],
  ["What does it cost to run?", "A full 30-second edit with tracking and transcription came to $0.53 in Meta Model API calls. The editor shows the running cost."],
  ["What if it gets something wrong?", "A checker outside the agent renders the cut and flags problems in red on the timeline. The agent fixes them before it hands over."],
  ["Who owns my footage?", "You do. Projects are private to your account, and deleting one removes its footage, renders and history."],
] as const;

/** (09) FAQ: two columns of numbered answers, nothing hidden behind accordions. */
export function Faq() {
  return (
    <section id="faq" className="paper-texture bg-paper px-[var(--gutter)] py-[clamp(120px,18vh,200px)] text-ink">
      <div className="mx-auto max-w-[1300px]">
        <div className="text-center">
          <Kicker tone="tomato">(09) FAQ</Kicker>
          <RevealLines className="display mt-6 text-[clamp(64px,12vw,220px)] leading-[0.84] text-tomato" lines={[{ text: "Fair questions." }]} />
        </div>
        <dl className="mt-16 grid gap-x-12 md:grid-cols-2">
          {FAQ.map(([q, a], i) => (
            <div key={q} className="grid grid-cols-[2.5rem_1fr] border-t-2 border-ink py-7">
              <span className="label pt-2 text-[10px] text-tomato">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <dt className="display text-[clamp(28px,2.6vw,40px)]">{q}</dt>
                <dd className="mt-2 max-w-[50ch] text-[15px] leading-relaxed text-ink/70">{a}</dd>
              </div>
            </div>
          ))}
        </dl>
        <p className="mt-14 text-center">
          <a href="#top" className="label text-[11px] text-tomato hover:underline">
            [ Back to top ]
          </a>
        </p>
      </div>
    </section>
  );
}

const MAKING = [
  { value: "vlog", label: "Vlogs" },
  { value: "talking", label: "Talking heads" },
  { value: "cinematic", label: "Montages" },
  { value: "none", label: "Not sure yet" },
] as const;

type Making = (typeof MAKING)[number]["value"];

/**
 * (10) Say hi: pick what you're making, then sign up with Clerk; the new account lands in the studio
 * with that recipe open.
 */
export function SayHi() {
  const reduce = useReducedMotion();
  const { play } = useExperience();
  const [making, setMaking] = useState<Making>("vlog");
  const [poked, setPoked] = useState(0);
  const studio = making === "none" ? "/studio" : `/studio?recipe=${making}`;

  return (
    <section id="start" className="mat relative overflow-hidden px-[var(--gutter)] pt-[clamp(120px,18vh,200px)] pb-[clamp(100px,14vh,160px)] text-paper">
      <RainbowArcs corner="top-left" className="pointer-events-none absolute -top-10 -left-10 size-[min(46vw,560px)]" />
      <div className="relative mx-auto max-w-[1000px] text-center">
        <Kicker tone="lime">(10) Say hi</Kicker>
        <RevealLines
          className="mx-auto mt-6 max-w-[14ch] text-[clamp(60px,9.4vw,170px)] leading-[0.86]"
          lines={[
            { text: "Upload your clips.", className: "display" },
            { text: "say what you want.", className: "font-serif italic normal-case text-lime pb-[0.04em]" },
          ]}
        />
        <p className="mx-auto mt-6 max-w-[48ch] text-[17px] leading-relaxed text-paper/75">
          Make an account and your first project opens with the recipe you pick. Up to five minutes of footage per project.
        </p>
      </div>

      <div className="relative mx-auto mt-16 grid max-w-[1200px] items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
        <div className="hidden flex-col items-center lg:flex">
          <div className="relative">
            <motion.button
              type="button"
              key={poked}
              aria-label="Poke the mascot"
              onClick={() => {
                setPoked((n) => n + 1);
                play("pop");
              }}
              animate={reduce ? undefined : { scale: [1, 0.85, 1.08, 1], rotate: [0, -8, 5, 0] }}
              transition={{ duration: 0.6, ease: EASE_OUT }}
            >
              <Image
                src={poked % 2 ? "/assets/mascot-wink.webp" : "/assets/mascot.webp"}
                alt=""
                width={260}
                height={260}
                className="drop-shadow-[0_30px_40px_rgba(0,0,0,0.5)]"
              />
            </motion.button>
            <p className="absolute -top-2 -right-24 rotate-[-8deg] font-hand text-[24px] text-lime">{poked ? "again?" : "poke me."}</p>
          </div>
          <p className="label mt-8 text-[10px] text-paper/50">Built for the Meta AI developer hackathon</p>
        </div>

        <div className="relative">
          <RainbowArcs className="pointer-events-none absolute -right-40 -bottom-40 hidden size-[420px] lg:block" />
          <div className="paper-texture relative rounded-[22px] border-2 border-ink bg-paper p-7 text-ink shadow-[10px_10px_0_0_var(--lime)] sm:p-9">
            <Chips label="What are you making?" options={MAKING} value={making} onChange={setMaking} />
            <p className="mt-6 text-[15px] leading-relaxed text-ink/70">
              Sign up with Google or email. Your first project opens with this recipe: the format set and a first brief written for the agent.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
              <PillButton href={`/signup?next=${encodeURIComponent(studio)}`}>Start my first edit</PillButton>
              <p className="rotate-[-3deg] font-hand text-[20px] text-ink/55">no spam, pinky promise.</p>
            </div>
            <p className="mt-6 text-[14px] text-ink/60">
              Already have an account?{" "}
              <Link href={`/login?next=${encodeURIComponent(studio)}`} className="font-semibold text-ink underline decoration-tomato decoration-2 underline-offset-4">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="mat overflow-hidden px-[var(--gutter)] pt-20 pb-6 text-paper">
      <div className="grid gap-12 border-t border-paper/15 pt-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-5 max-w-[34ch] text-[14px] leading-relaxed text-paper/65">
            A video editor with an agent that watches your clips, cuts them on a timeline you can change, and checks the result before you see it. Built for the
            Meta AI developer hackathon on Muse Spark, SAM 3.1 and Voice Transcribe.
          </p>
        </div>
        <FooterCol title="Sitemap" links={[["Work", "#work"], ["Agent", "#agent"], ["Process", "#process"], ["FAQ", "#faq"]]} />
        <FooterCol title="App" links={[["Studio", "/studio"], ["Sign in", "/login"], ["Create account", "/signup"]]} />
        <FooterCol title="Built on" links={[["Muse Spark", null], ["SAM 3.1", null], ["Voice Transcribe", null]]} />
      </div>
      <p aria-hidden className="display mt-14 text-center text-[34vw] leading-[0.76] tracking-[-0.01em] text-lime select-none">
        Auteur
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-paper/15 pt-5 pr-16">
        <p className="label text-[10px] text-paper/50">© 2026 Auteur Labs</p>
        <a href="#top" className="label text-[10px] text-paper/50 hover:text-paper">
          Back to top ↑
        </a>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string | null][] }) {
  return (
    <div>
      <p className="label text-[10px] text-paper/45">{title}</p>
      <ul className="mt-4 space-y-2">
        {links.map(([label, href]) => (
          <li key={label} className="text-[15px]">
            {href ? (
              <a href={href} className="text-paper/85 transition-colors hover:text-lime">
                {label}
              </a>
            ) : (
              <span className="text-paper/85">{label}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
