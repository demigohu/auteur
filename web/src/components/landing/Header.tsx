"use client";

import { ArrowUpRight } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { useExperience } from "./experience";

const NAV = [
  { href: "#work", label: "Work" },
  { href: "#agent", label: "Agent" },
  { href: "#process", label: "Process" },
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
              Start editing <ArrowUpRight size={15} weight="bold" />
            </Link>
          </div>
          <PullTag />
        </motion.div>
      </div>
    </header>
  );
}

/** A luggage tag on a string. Pull it down far enough and it opens sign-up; let go early and it swings back. */
function PullTag() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { play } = useExperience();
  const [pulled, setPulled] = useState(false);

  return (
    <div className="relative -mt-4 hidden w-14 xl:block" aria-hidden={false}>
      <div className="absolute top-0 left-1/2 h-6 w-[2px] -translate-x-1/2 bg-ink" />
      <motion.button
        type="button"
        aria-label="Pull to sign up"
        drag={reduce ? false : "y"}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.9 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 90) {
            setPulled(true);
            play("whoosh");
            setTimeout(() => router.push("/signup"), 350);
          }
        }}
        onClick={() => router.push("/signup")}
        animate={pulled ? { y: 400, rotate: 18, opacity: 0 } : { rotate: [0, -5, 4, -2, 0] }}
        transition={pulled ? { duration: 0.5, ease: [0.6, 0, 0.8, 0.4] } : { duration: 3.6, repeat: Infinity, repeatDelay: 2.4, ease: "easeInOut" }}
        style={{ transformOrigin: "50% 0%" }}
        className="relative mt-6 flex h-[70px] w-14 cursor-grab flex-col items-center border-2 border-ink bg-paper pt-2 shadow-[0_3px_0_0_var(--ink)] [clip-path:polygon(0_0,100%_0,100%_86%,88%_100%,76%_88%,64%_100%,52%_88%,40%_100%,28%_88%,16%_100%,0_86%)] active:cursor-grabbing"
      >
        <span className="size-2 rounded-full border-2 border-ink" />
        <span className="display mt-1 text-center text-[17px] leading-[0.85] text-ink">
          Pull
          <br />
          me
        </span>
      </motion.button>
    </div>
  );
}
