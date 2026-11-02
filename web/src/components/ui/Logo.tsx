import { Waveform } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

/** The lime logo pill, tilted like a sticker (docs/DESIGN.md, "Logo"). */
export function Logo({ href = "/", size = "md" }: { href?: string; size?: "sm" | "md" }) {
  return (
    <Link
      href={href}
      aria-label="Auteur home"
      className={`display inline-flex -rotate-3 items-center gap-1.5 rounded-full border-2 border-ink bg-lime text-ink shadow-[0_3px_0_0_var(--ink)] transition-transform duration-300 ease-[var(--ease-back)] hover:rotate-0 ${
        size === "sm" ? "px-3 pt-1 pb-0.5 text-[17px]" : "px-4 pt-1.5 pb-1 text-[22px]"
      }`}
    >
      Auteur
      <Waveform size={size === "sm" ? 13 : 16} weight="bold" className="-mt-0.5 text-tomato" />
    </Link>
  );
}
