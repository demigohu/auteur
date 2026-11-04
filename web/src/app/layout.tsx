import type { Metadata } from "next";
import { Anton, Caveat, Geist_Mono, Instrument_Serif, Inter_Tight } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { clerkAppearance } from "@/components/auth/appearance";
import "./globals.css";

// Type pairing from docs/DESIGN.md: Anton display, Instrument Serif italic accents, Inter Tight UI,
// Geist Mono labels, Caveat handwritten notes.
const display = Anton({ variable: "--font-anton", weight: "400", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-instrument", weight: "400", style: ["italic", "normal"], subsets: ["latin"] });
const sans = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const hand = Caveat({ variable: "--font-caveat", weight: ["400", "600"], subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Auteur · Say the edit, get the cut", template: "%s" },
  description: "A video editor whose agent watches your clips, hears every word and builds the edit on a timeline you can change.",
  openGraph: {
    title: "Auteur · Say the edit, get the cut",
    description: "A video editor whose agent watches your clips, hears every word and builds the edit on a timeline you can change. Built on Muse Spark, SAM 3.1, Muse Wonder, Muse Image and Voice Transcribe.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${serif.variable} ${sans.variable} ${mono.variable} ${hand.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ClerkProvider
          signInUrl="/login"
          signUpUrl="/signup"
          signInFallbackRedirectUrl="/studio"
          signUpFallbackRedirectUrl="/studio"
          afterSignOutUrl="/"
          appearance={clerkAppearance}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
