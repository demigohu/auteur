import { AgentNote, Faq, Footer, SayHi } from "@/components/landing/Closing";
import { ExperienceProvider } from "@/components/landing/experience";
import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { AgentSection, EditorSection, StackTape } from "@/components/landing/Product";
import { Process, Receipts, Toolkit } from "@/components/landing/Proof";
import { Statement } from "@/components/landing/Statement";
import { ThreeWords } from "@/components/landing/ThreeWords";
import { DiveIn, Work } from "@/components/landing/Work";

export default function Page() {
  return (
    <ExperienceProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[90] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper">
        Skip to content
      </a>
      <div className="grain" aria-hidden />
      <Header />
      <main id="main" className="overflow-x-clip">
        <span id="top" />
        <Hero />
        <Statement />
        <ThreeWords />
        <StackTape />
        <AgentSection />
        <EditorSection />
        <DiveIn />
        <Work />
        <Receipts />
        <Toolkit />
        <Process />
        <AgentNote />
        <Faq />
        <SayHi />
      </main>
      <Footer />
    </ExperienceProvider>
  );
}
