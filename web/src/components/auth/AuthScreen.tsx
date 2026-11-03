"use client";

import { SignIn, SignUp } from "@clerk/nextjs";
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { RainbowArcs } from "@/components/ui/RainbowArcs";

type Mode = "signin" | "signup";

const COPY = {
  signin: { title: "Welcome back.", accent: "your projects are where you left them." },
  signup: { title: "Upload your clips.", accent: "say what you want." },
} as const;

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * Sign-in and sign-up share one screen: our headline and mascot on the left, Clerk's form on the right
 * (styled in components/auth/appearance.ts). `?next=` (from the landing page's recipe chips) picks
 * where a new session lands; Clerk's own `redirect_url` covers protected-page bounces.
 */
export function AuthScreen({ mode }: { mode: Mode }) {
  const next = useSearchParams().get("next");
  const reduce = useReducedMotion();
  const [poked, setPoked] = useState(0);
  const copy = COPY[mode];
  // Only same-site paths, so ?next= cannot send a fresh session to another origin.
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : undefined;

  const enter = (i: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.1 + i * 0.08, duration: 0.8, ease: EASE_OUT } };

  return (
    <main className="mat relative min-h-[100dvh] overflow-hidden px-[var(--gutter)] pt-6 pb-16 text-paper">
      <RainbowArcs className="pointer-events-none absolute -right-24 -bottom-24 hidden size-[640px] lg:block" />

      <nav className="relative z-10 flex items-center justify-between">
        <Logo />
        <p className="label hidden text-paper/50 sm:block">(00) The cutting room</p>
      </nav>

      <div className="relative z-10 mx-auto mt-12 grid max-w-[1320px] items-center gap-14 lg:mt-16 lg:grid-cols-[1fr_minmax(0,520px)]">
        <div>
          <motion.span {...enter(0)} className="label inline-flex rounded-[4px] bg-lime px-2 py-1 text-forest">
            ⁞ {mode === "signin" ? "Sign in" : "New account"}
          </motion.span>
          <motion.h1 {...enter(1)} className="display mt-6 text-[clamp(64px,9vw,148px)] text-paper">
            {copy.title}
          </motion.h1>
          <motion.p {...enter(2)} className="pb-2 font-serif text-[clamp(44px,6vw,96px)] leading-[1] italic text-lime">
            {copy.accent}
          </motion.p>

          <motion.div {...enter(3)} className="relative mt-8 hidden w-fit lg:block">
            <motion.button
              type="button"
              aria-label="Poke the mascot"
              onClick={() => setPoked((n) => n + 1)}
              animate={reduce ? undefined : { scale: [1, 0.86, 1.08, 1], rotate: [0, -6, 4, 0] }}
              transition={{ duration: 0.6, ease: EASE_OUT }}
              key={poked}
              className="block cursor-pointer"
            >
              <Image src="/assets/mascot.webp" alt="" width={220} height={220} priority className="drop-shadow-[0_24px_30px_rgba(0,0,0,0.45)]" />
            </motion.button>
            <p className="absolute top-2 -right-36 rotate-[-6deg] font-hand text-[24px] text-lime">
              {poked ? (poked > 3 ? "ok. go edit." : "again?") : "poke me."}
            </p>
          </motion.div>
        </div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 40, rotate: 2 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ delay: 0.25, duration: 0.9, ease: EASE_OUT }}
          className="flex justify-center lg:justify-end"
        >
          {mode === "signin" ? (
            <SignIn routing="hash" signUpUrl="/signup" forceRedirectUrl={destination} />
          ) : (
            <SignUp routing="hash" signInUrl="/login" forceRedirectUrl={destination} />
          )}
        </motion.div>
      </div>
    </main>
  );
}
