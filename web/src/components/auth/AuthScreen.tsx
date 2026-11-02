"use client";

import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Field, SubmitButton } from "@/components/ui/form";
import { Logo } from "@/components/ui/Logo";
import { RainbowArcs } from "@/components/ui/RainbowArcs";
import { ApiError, api } from "@/lib/api";

type Mode = "signin" | "signup";
type Errors = Partial<Record<"name" | "email" | "password" | "form", string>>;

const COPY = {
  signin: { title: "Welcome back.", accent: "the footage missed you.", cta: "Sign in", busy: "Signing in" },
  signup: { title: "Got footage", accent: "to cut?", cta: "Create account", busy: "Creating account" },
} as const;

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

function validate(mode: Mode, form: FormData): Errors {
  const errors: Errors = {};
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (mode === "signup" && !String(form.get("name") ?? "").trim()) errors.name = "Tell us what to call you.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = "That doesn't look like an email address.";
  if (mode === "signup" && password.length < 8) errors.password = "Use at least 8 characters.";
  if (mode === "signin" && !password) errors.password = "Enter your password.";
  return errors;
}

/** Sign-in and sign-up share one screen, modelled on the reference's "say hi" section. */
export function AuthScreen({ mode }: { mode: Mode }) {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const reduce = useReducedMotion();
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [poked, setPoked] = useState(0);
  const copy = COPY[mode];
  // Only same-site paths, so ?next= cannot bounce a fresh session to another origin.
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/studio";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const found = validate(mode, form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const email = String(form.get("email")).trim();
      const password = String(form.get("password"));
      if (mode === "signup") await api.signUp({ name: String(form.get("name")).trim(), email, password });
      else await api.signIn({ email, password });
      router.replace(destination);
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Couldn't reach the server. Is the API running on port 8000?";
      setErrors(err instanceof ApiError && err.status === 409 ? { email: message } : { form: message });
      setBusy(false);
    }
  }

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
              <Image src="/assets/mascot.png" alt="" width={220} height={220} priority className="drop-shadow-[0_24px_30px_rgba(0,0,0,0.45)]" />
            </motion.button>
            <p className="absolute top-2 -right-36 rotate-[-6deg] font-hand text-[24px] text-lime">
              {poked ? (poked > 3 ? "ok ok. go edit." : "hehe. again?") : "poke me. i squeak."}
            </p>
          </motion.div>
        </div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 40, rotate: 2 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ delay: 0.25, duration: 0.9, ease: EASE_OUT }}
          className="paper-texture rounded-[22px] border-2 border-ink bg-paper p-7 text-ink shadow-[10px_10px_0_0_var(--lime)] sm:p-9"
        >
          <div role="tablist" aria-label="Account" className="flex w-fit rounded-full border-2 border-ink p-1">
            {(["signin", "signup"] as const).map((m) => (
              <Link
                key={m}
                role="tab"
                aria-selected={mode === m}
                href={`/${m === "signin" ? "login" : "signup"}${next ? `?next=${encodeURIComponent(next)}` : ""}`}
                className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${mode === m ? "bg-ink text-lime" : "text-ink/60 hover:text-ink"}`}
              >
                {m === "signin" ? "Sign in" : "Create account"}
              </Link>
            ))}
          </div>

          <form onSubmit={submit} noValidate className="mt-8 space-y-6">
            {mode === "signup" && <Field label="Your name" name="name" autoComplete="name" placeholder="Rosa Lindqvist" error={errors.name} autoFocus />}
            <Field
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@studio.com"
              error={errors.email}
              autoFocus={mode === "signin"}
            />
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder={mode === "signup" ? "8 characters or more" : "Your password"}
              error={errors.password}
            />
            {errors.form && (
              <p role="alert" className="rounded-[10px] border-2 border-ink bg-sun px-3 py-2 text-sm">
                {errors.form}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <SubmitButton busy={busy}>{busy ? copy.busy : copy.cta}</SubmitButton>
              <p className="rotate-[-3deg] font-hand text-[20px] text-ink/60">
                {mode === "signup" ? "no spam, pinky promise." : "your timelines are waiting."}
              </p>
            </div>
          </form>

          <p className="mt-8 border-t-2 border-ink/10 pt-5 text-sm text-ink/60">
            {mode === "signin" ? "New to Auteur? " : "Already have an account? "}
            <Link href={mode === "signin" ? "/signup" : "/login"} className="font-semibold text-ink underline decoration-tomato decoration-2 underline-offset-4">
              {mode === "signin" ? "Create an account" : "Sign in"}
            </Link>
          </p>
        </motion.div>
      </div>
    </main>
  );
}
