"use client";

import { useId } from "react";

import type { Dictionary } from "@/i18n/dictionary";

import { themeChoices } from "./theme";
import { useTheme } from "./use-theme";

type ThemeSelectProps = { labels: Dictionary["common"]["theme"] };

/** Light, dark or follow the device. Lives in the footer and the phone menu. */
export function ThemeSelect({ labels }: ThemeSelectProps) {
  const { choice, choose } = useTheme();
  const name = useId();

  return (
    <div role="radiogroup" aria-label={labels.label} className="inline-flex rounded-xl border border-input bg-card p-1">
      {themeChoices.map((option) => (
        // The radio and its text share one grid cell, so the whole pill is the
        // control and it needs no absolute positioning.
        <label key={option} className="grid cursor-pointer">
          <input
            type="radio"
            name={name}
            value={option}
            checked={choice === option}
            onChange={() => choose(option)}
            className="peer col-start-1 row-start-1 min-h-9 appearance-none rounded-lg checked:bg-secondary"
          />
          <span className="pointer-events-none col-start-1 row-start-1 self-center px-3 text-sm font-medium text-muted-foreground peer-checked:text-foreground">
            {labels[option]}
          </span>
        </label>
      ))}
    </div>
  );
}
