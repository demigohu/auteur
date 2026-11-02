"use client";

import { ArrowUpRight } from "@phosphor-icons/react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
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

export function Header() {
  const { scrollY } = useScroll();
  const [top, setTop] = useState(true);
  const { play } = useExperience();
  useMotionValueEvent(scrollY, "change", (y) => setTop(y < 40));

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 px-[var(--gutter)] pt-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-4">
        <div className="pointer-events-auto">
          <Logo />
          <p className={`label mt-3 text-[10px] text-ink/60 transition-opacity duration-300 ${top ? "opacity-100" : "opacity-0"}`}>(01) AI video editor</p>
        </div>

        <nav aria-label="Main" className="pointer-events-auto hidden rounded-full border-2 border-ink bg-paper px-2 py-1.5 shadow-[0_3px_0_0_var(--ink)] md:block">
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
        </nav>

        <div className="pointer-events-auto flex items-start justify-end gap-4">
          <div className="flex flex-col items-end">
            <Link
              href="/signup"
              onMouseEnter={() => play("tick")}
              className="hard inline-flex h-10 items-center gap-1.5 rounded-full bg-pink px-4 text-[14px] font-semibold whitespace-nowrap text-ink"
            >
              Start editing <ArrowUpRight size={15} weight="bold" />
            </Link>
            <p className={`label mt-3 hidden text-right text-[10px] text-ink/60 transition-opacity duration-300 lg:block ${top ? "opacity-100" : "opacity-0"}`}>
              Muse Spark + SAM 3.1 + Voice / built on Meta
            </p>
          </div>
          <PullTag />
        </div>
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
