import Image from "next/image";
import Link from "next/link";

/** The Auteur wordmark sticker (public/assets/logo.png): lime pill, REC dot. Straightens on hover. */
export function Logo({ href = "/", size = "md" }: { href?: string; size?: "sm" | "md" }) {
  const h = size === "sm" ? 34 : 44;
  const w = Math.round(h * RATIO);
  return (
    <Link href={href} aria-label="Auteur home" className="inline-block transition-transform duration-300 ease-[var(--ease-back)] hover:-rotate-3 hover:scale-[1.04]">
      <Image src="/assets/logo.png" alt="Auteur" width={w} height={h} priority className="block" style={{ width: w, height: h }} />
    </Link>
  );
}

const RATIO = 900 / 446;
