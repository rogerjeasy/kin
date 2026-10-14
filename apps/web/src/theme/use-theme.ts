"use client";

import { useSyncExternalStore } from "react";

import type { Theme, ThemeChoice } from "./theme";
import { chooseTheme, currentChoice, currentTheme, subscribeToTheme } from "./theme-store";

type ThemeState = {
  /** What the visitor picked: light, dark or follow the device. */
  choice: ThemeChoice;
  /** What is showing right now. */
  theme: Theme;
  choose: (choice: ThemeChoice) => void;
};

// The server cannot know the visitor's theme. It renders these, and the real
// values arrive on hydration. themeScript has already painted the right colours.
const serverChoice: ThemeChoice = "system";
const serverTheme: Theme = "light";

export function useTheme(): ThemeState {
  const choice = useSyncExternalStore(subscribeToTheme, currentChoice, () => serverChoice);
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme, () => serverTheme);
  return { choice, theme, choose: chooseTheme };
}
