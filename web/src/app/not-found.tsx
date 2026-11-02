import Image from "next/image";
import { PillButton } from "@/components/landing/primitives";
import { Logo } from "@/components/ui/Logo";

export default function NotFound() {
  return (
    <main className="paper-texture relative grid min-h-[100dvh] place-items-center overflow-hidden bg-paper px-[var(--gutter)] py-20 text-ink">
      <div className="absolute top-6 left-[var(--gutter)]">
        <Logo />
      </div>
      <div className="text-center">
        <Image src="/assets/mascot.png" alt="" width={140} height={140} className="mx-auto rotate-12 drop-shadow-[0_16px_20px_rgba(0,0,0,0.25)]" />
        <p className="label mt-6 text-ink/50">Error 404</p>
        <h1 className="display mt-3 text-[clamp(80px,14vw,220px)] text-tomato">Cut.</h1>
        <p className="font-serif text-[clamp(30px,3.6vw,52px)] leading-tight italic">this scene never made the edit.</p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <PillButton href="/">Back to the start</PillButton>
          <PillButton href="/studio" tone="paper">
            Open the studio
          </PillButton>
        </div>
      </div>
    </main>
  );
}
