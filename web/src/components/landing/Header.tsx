"use client";

import { ArrowUpRight } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { useExperience } from "./experience";

const NAV = [
  { href: "#work", label: "Test runs" },
  { href: "#agent", label: "Agent" },
  { href: "#process", label: "How it works" },
  { href: "#faq", label: "FAQ" },
];

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export function Header() {
  const { play, entered } = useExperience();
  const reduce = useReducedMotion();
  // Logo, nav and CTA drop in once the intro has opened (the reference's "nav-in").
  const drop = (d: number) =>
    reduce ? {} : { initial: { y: -40, opacity: 0 }, animate: entered ? { y: 0, opacity: 1 } : undefined, transition: { delay: d, duration: 0.8, ease: EASE_OUT } };

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 px-[var(--gutter)] pt-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-4">
        <motion.div {...drop(0.2)} className="pointer-events-auto">
          <Logo />
        </motion.div>

        <motion.nav {...drop(0.3)} aria-label="Main" className="pointer-events-auto hidden rounded-full border-2 border-ink bg-paper px-2 py-1.5 shadow-[0_3px_0_0_var(--ink)] md:block">
          <ul className="flex items-center">
            {NAV.map((n) => (
              <li key={n.href}>
                <a
                  href={n.href}
                  onMouseEnter={() => play("tick")}
                  className="label block rounded-full px-4 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-ink hover:text-paper"
                >
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </motion.nav>

        <motion.div {...drop(0.4)} className="pointer-events-auto flex items-start justify-end gap-4">
          <div className="flex flex-col items-end">
            <Link
              href="/signup"
              onMouseEnter={() => play("tick")}
              className="hard inline-flex h-10 items-center gap-1.5 rounded-full bg-pink px-4 text-[14px] font-semibold whitespace-nowrap text-ink"
            >
              Start my first edit <ArrowUpRight size={15} weight="bold" />
            </Link>
          </div>
          <RecButton />
        </motion.div>
      </div>
    </header>
  );
}

/**
 * A camera REC badge with a blinking dot and a running clock (it has been "recording" since you
 * arrived). Pressing it starts the real thing: sign-up.
 */
function RecButton() {
  const router = useRouter();
  const { play, entered } = useExperience();
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!entered) return;
    const t = setInterval(() => setSecs((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [entered]);

  return (
    <button
      type="button"
      onMouseEnter={() => play("tick")}
      onClick={() => {
        play("clap");
        router.push("/signup");
      }}
      aria-label="Start recording: create an account"
      className="group hidden h-10 items-center gap-2 rounded-full border-2 border-ink bg-ink pr-3.5 pl-3 text-paper shadow-[0_3px_0_0_var(--ink)] transition-transform active:translate-y-0.5 xl:inline-flex"
    >
      <span className="relative grid size-3 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#ff3b30] opacity-60" />
        <span className="relative size-3 rounded-full bg-[#ff3b30]" />
      </span>
      <span className="font-mono text-[12px] font-semibold tracking-[0.1em]">REC</span>
      <span className="font-mono text-[12px] text-paper/60 tabular-nums group-hover:text-lime">
        {String(Math.floor(secs / 60)).padStart(2, "0")}:{String(secs % 60).padStart(2, "0")}
      </span>
    </button>
  );
}
