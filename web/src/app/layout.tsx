import type { Metadata } from "next";
import { Anton, Caveat, Geist_Mono, Instrument_Serif, Inter_Tight } from "next/font/google";
import "./globals.css";

// Type pairing from docs/DESIGN.md: Anton display, Instrument Serif italic accents, Inter Tight UI,
// Geist Mono labels, Caveat handwritten notes.
const display = Anton({ variable: "--font-anton", weight: "400", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-instrument", weight: "400", style: ["italic", "normal"], subsets: ["latin"] });
const sans = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const hand = Caveat({ variable: "--font-caveat", weight: ["400", "600"], subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Auteur · The video editor you can talk to", template: "%s" },
  description: "Auteur is a video editor with an agent that watches and listens to your footage, builds a timeline you can still edit, and checks its own work.",
  openGraph: {
    title: "Auteur · Shoot raw. Just say cut.",
    description: "A video editor with an agent that watches, listens, cuts and checks its own work. Built on Meta Muse Spark, SAM 3.1 and Voice.",
    images: ["/assets/og.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${serif.variable} ${sans.variable} ${mono.variable} ${hand.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
