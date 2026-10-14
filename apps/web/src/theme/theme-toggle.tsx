"use client";

import { MoonIcon, SunIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { useTheme } from "./use-theme";

type ThemeToggleProps = {
  labels: Dictionary["common"]["theme"];
  className?: string;
};

/** One button in the header that flips between light and dark. */
export function ThemeToggle({ labels, className }: ThemeToggleProps) {
  const { theme, choose } = useTheme();
  const isDark = theme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      aria-label={isDark ? labels.switchToLight : labels.switchToDark}
      onClick={() => choose(isDark ? "light" : "dark")}
    >
      {/* Both icons render, and the theme attribute picks one, so the icon is
          right before hydration. */}
      <SunIcon className="dark:hidden" />
      <MoonIcon className="hidden dark:block" />
    </Button>
  );
}
