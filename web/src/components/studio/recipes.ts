import type { NewProject } from "@/lib/api";

/** Starting briefs: each opens New project with a format and a first instruction for the agent. */
export type Recipe = {
  id: string;
  title: string;
  blurb: string;
  aspect: NewProject["aspect"];
  fps: NewProject["fps"];
  brief: string;
  color: string;
  ink: string;
};

export const RECIPES: Recipe[] = [
  {
    id: "vlog",
    title: "Day-in-my-life",
    blurb: "Chronological, cut on the beat, slow-mo on the best moments.",
    aspect: "9:16",
    fps: 30,
    brief: "Make a 30-second day-in-my-life vlog in chronological order. Use my music, cut on the beat, slow down the best walking shots and finish with a warm cinematic grade.",
    color: "var(--tomato)",
    ink: "var(--ink)",
  },
  {
    id: "talking",
    title: "Talking-head cleanup",
    blurb: "Fillers and long pauses out, subtitles in, color matched.",
    aspect: "16:9",
    fps: 30,
    brief: "Remove the ums, uhs and long pauses, add bold subtitles, and match the color across all clips.",
    color: "var(--lime)",
    ink: "var(--forest)",
  },
  {
    id: "cinematic",
    title: "Cinematic montage",
    blurb: "Graded from LOG, letterboxed, crossfades and film grain.",
    aspect: "16:9",
    fps: 24,
    brief: "Turn these clips into a 45-second cinematic montage: grade from LOG, add letterbox and grain, crossfade between shots and keep the music up.",
    color: "var(--blue)",
    ink: "var(--paper)",
  },
  {
    id: "podcast",
    title: "Podcast clip",
    blurb: "Reframed to the speaker, captions that pop, ready for Reels.",
    aspect: "9:16",
    fps: 30,
    brief: "Find the best 40 seconds, reframe to vertical following whoever is speaking, and add karaoke-style subtitles.",
    color: "var(--pink)",
    ink: "var(--ink)",
  },
  {
    id: "privacy",
    title: "Blur the background",
    blurb: "Track faces and plates, blur everything that isn't the subject.",
    aspect: "16:9",
    fps: 30,
    brief: "Blur the faces of people in the background and any license plates, but keep the main subject sharp.",
    color: "var(--sun)",
    ink: "var(--ink)",
  },
];
