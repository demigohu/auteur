"use client";

import { useSyncExternalStore } from "react";

/**
 * The app's day (all paper) or night (all dark) look, shared by the studio and the editor; night by
 * default, remembered per browser. The landing and sign-in pages keep their one designed look.
 */
export type Theme = "day" | "night";

const KEY = "auteur:theme";
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    return localStorage.getItem(KEY) === "day" ? "day" : "night";
  } catch {
    return "night";
  }
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, read, () => "night");
}
