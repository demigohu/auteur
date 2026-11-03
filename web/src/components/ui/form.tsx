"use client";

import { ArrowRight, CircleNotch } from "@phosphor-icons/react";

/** Pill choices; the chosen one goes ink with a lime label. */
export function Chips<T extends string>(props: { label: string; options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="label text-[10px] text-ink/60">{props.label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {props.options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={props.value === o.value}
            onClick={() => props.onChange(o.value)}
            className={`rounded-full border-2 border-ink px-3.5 py-1.5 text-[13px] font-medium transition-[background-color,color,transform] duration-200 active:scale-[0.97] ${
              props.value === o.value ? "bg-ink text-lime" : "text-ink hover:bg-ink/5"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** The two-part submit pill: ink cap with an arrow, pink label. */
export function SubmitButton({ children, busy, disabled }: { children: React.ReactNode; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="hard group inline-flex h-12 items-stretch overflow-hidden rounded-full bg-pink text-[15px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="grid w-12 place-items-center bg-ink text-paper transition-colors duration-200 group-hover:bg-tomato">
        {busy ? (
          <CircleNotch size={18} className="animate-spin" />
        ) : (
          <ArrowRight size={18} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
        )}
      </span>
      <span className="flex items-center whitespace-nowrap pr-6 pl-4">{children}</span>
    </button>
  );
}
