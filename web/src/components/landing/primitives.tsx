import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

/** Two-part pill: ink cap with an arrow, then the label (docs/DESIGN.md, "Primary button"). */
export function PillButton(props: { href: string; children: React.ReactNode; tone?: "pink" | "paper"; onDark?: boolean }) {
  const { href, children, tone = "pink", onDark = false } = props;
  return (
    <Link
      href={href}
      // On ink sections the ink border and cap would vanish, so they flip to paper and lime.
      style={onDark ? { borderColor: "var(--paper)", boxShadow: "0 4px 0 0 var(--paper)" } : undefined}
      className={`hard group inline-flex h-12 items-stretch overflow-hidden rounded-full text-[15px] font-semibold tracking-[-0.01em] text-ink ${
        tone === "pink" ? "bg-pink" : "bg-paper"
      }`}
    >
      <span
        className={`grid w-12 place-items-center transition-colors duration-200 group-hover:bg-tomato ${
          onDark ? "bg-lime text-forest" : "bg-ink text-paper"
        }`}
      >
        <ArrowRight size={18} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
      </span>
      <span className="flex items-center whitespace-nowrap pr-6 pl-4">{children}</span>
    </Link>
  );
}

export function CtaChip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="hard inline-flex h-10 items-center gap-2 rounded-full bg-pink px-4 text-sm font-semibold whitespace-nowrap text-ink"
    >
      {children}
      <ArrowUpRight size={15} weight="bold" />
    </Link>
  );
}

/** Small mono kicker tag ("⁞ (02) The agent"); one per section at most. */
export function Kicker({ children, tone = "forest" }: { children: React.ReactNode; tone?: "forest" | "ink" | "paper" | "blue" | "lime" | "tomato" }) {
  const cls = {
    forest: "bg-forest text-lime",
    ink: "bg-ink text-paper",
    paper: "bg-paper text-ink",
    blue: "bg-blue text-paper",
    lime: "bg-lime text-forest",
    tomato: "bg-tomato text-ink",
  }[tone];
  return <span className={`label inline-flex items-center gap-1.5 rounded-[4px] px-2 py-1 ${cls}`}>⁞ {children}</span>;
}

/** Twelve-point starburst stamp. */
export function Starburst({ color, className, children }: { color: string; className?: string; children: React.ReactNode }) {
  const points = Array.from({ length: 24 }, (_, i) => {
    const r = i % 2 ? 38 : 50;
    const a = (Math.PI * 2 * i) / 24 - Math.PI / 2;
    // Rounded so server and browser render identical points (no hydration mismatch).
    return `${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  return (
    <div className={`relative grid place-items-center ${className ?? ""}`}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
        <polygon points={points} fill={color} stroke="#121110" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}

/** Circular text on a path, spinning slowly around a centre icon. */
export function RotatingBadge(props: { text: string; children: React.ReactNode; className?: string; tone?: "paper" | "lime" }) {
  const { text, children, className, tone = "paper" } = props;
  return (
    <div className={`relative grid place-items-center rounded-full bg-ink ${tone === "lime" ? "text-lime" : "text-paper"} ${className ?? ""}`}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full animate-[spin-slow_14s_linear_infinite]" aria-hidden>
        <defs>
          <path id="badge-circle" d="M50,50 m-36,0 a36,36 0 1,1 72,0 a36,36 0 1,1 -72,0" />
        </defs>
        <text fill="currentColor" fontSize="9.5" letterSpacing="2.2" fontFamily="var(--font-geist-mono)">
          <textPath href="#badge-circle">{text}</textPath>
        </text>
      </svg>
      <div className="relative">{children}</div>
    </div>
  );
}

/** Handwritten margin note with a drawn arrow. */
export function Note({ children, className, arrow = "left" }: { children: React.ReactNode; className?: string; arrow?: "left" | "right" | "down" }) {
  return (
    <div className={`pointer-events-none font-hand text-[22px] leading-[1.05] font-semibold text-ink ${className ?? ""}`}>
      {arrow === "left" && (
        <svg width="54" height="34" viewBox="0 0 54 34" fill="none" className="mb-1 -ml-2" aria-hidden>
          <path d="M52 30C36 30 14 24 4 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M3 15L4 5L13 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <p className="max-w-[16ch]">{children}</p>
      {arrow === "right" && (
        <svg width="70" height="40" viewBox="0 0 70 40" fill="none" className="mt-1 ml-auto" aria-hidden>
          <path d="M2 4C20 30 44 36 66 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M57 15L66 18L62 27" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}
