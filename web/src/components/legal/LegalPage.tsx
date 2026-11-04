import Link from "next/link";

/** Contact for privacy and terms questions (also the Google sign-in support address). */
export const LEGAL_CONTACT = "rosalindgraham494@gmail.com";
export const LEGAL_UPDATED = "November 4, 2026";

/** Shared frame for the privacy policy and the terms: plain, readable, linked from the footer and Google sign-in. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-[100dvh] bg-paper px-[var(--gutter)] py-16 text-ink md:py-24">
      <article className="mx-auto max-w-[68ch]">
        <Link href="/" className="label text-[11px] text-ink/60 hover:text-ink">
          ← Auteur
        </Link>
        <h1 className="display mt-6 text-[clamp(40px,7vw,72px)] leading-[0.95]">{title}</h1>
        <p className="label mt-4 text-[11px] text-ink/60">Last updated {LEGAL_UPDATED}</p>
        <div className="mt-10 space-y-8 text-[16px] leading-relaxed [&_h2]:text-[20px] [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:space-y-1.5">
          {children}
        </div>
        <p className="mt-14 border-t-2 border-ink pt-6 text-[15px]">
          Questions: <a href={`mailto:${LEGAL_CONTACT}`} className="underline">{LEGAL_CONTACT}</a>
        </p>
      </article>
    </main>
  );
}
