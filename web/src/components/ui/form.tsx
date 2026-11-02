"use client";

import { ArrowRight, CircleNotch, Eye, EyeSlash } from "@phosphor-icons/react";
import { useId, useState } from "react";

/** Underlined field with a mono label, as on the reference contact form (docs/DESIGN.md, "Forms"). */
export function Field(props: {
  label: string;
  name: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  placeholder?: string;
  defaultValue?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  minLength?: number;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const password = props.type === "password";
  return (
    <div>
      <label htmlFor={id} className="label text-[10px] text-ink/60">
        {props.label}
      </label>
      <div
        className={`mt-1.5 flex items-center border-b-2 transition-colors focus-within:border-ink ${
          props.error ? "border-tomato" : "border-ink/25"
        }`}
      >
        <input
          id={id}
          name={props.name}
          type={password && shown ? "text" : (props.type ?? "text")}
          autoComplete={props.autoComplete}
          placeholder={props.placeholder}
          defaultValue={props.defaultValue}
          required={props.required}
          minLength={props.minLength}
          autoFocus={props.autoFocus}
          aria-invalid={Boolean(props.error)}
          aria-describedby={props.error || props.hint ? `${id}-note` : undefined}
          className="w-full bg-transparent py-2 text-[17px] text-ink placeholder:text-ink/30 focus:outline-none"
        />
        {password && (
          <button
            type="button"
            onClick={() => setShown(!shown)}
            aria-label={shown ? "Hide password" : "Show password"}
            className="shrink-0 rounded-full p-1.5 text-ink/50 transition-colors hover:text-ink"
          >
            {shown ? <EyeSlash size={17} /> : <Eye size={17} />}
          </button>
        )}
      </div>
      {(props.error || props.hint) && (
        <p id={`${id}-note`} className={`mt-1.5 text-[13px] ${props.error ? "text-tomato" : "text-ink/50"}`}>
          {props.error ?? props.hint}
        </p>
      )}
    </div>
  );
}

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
