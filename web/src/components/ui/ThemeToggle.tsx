"use client";

import { Moon, Sun } from "@phosphor-icons/react";
import { setTheme, useTheme } from "@/lib/theme";

/** Day / night pill for the studio and the editor. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className={`flex rounded-full border-2 border-edge bg-panel p-0.5 ${className}`}>
      {(["day", "night"] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          aria-label={t === "day" ? "Day" : "Night (best for judging color)"}
          title={t === "day" ? "Day" : "Night (best for judging color)"}
          onClick={() => setTheme(t)}
          className={`grid h-6 w-8 place-items-center rounded-full transition-colors ${theme === t ? "bg-text text-bg" : "text-muted hover:text-text"}`}
        >
          {t === "day" ? <Sun size={13} weight="bold" /> : <Moon size={13} weight="bold" />}
        </button>
      ))}
    </div>
  );
}
