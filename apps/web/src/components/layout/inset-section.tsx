import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Container } from "./container";

const tones = {
  /** The hero's ink: deep navy lit by drifting gold, blue and rose light. */
  ink: "aurora text-foreground shadow-xl",
  /** Warm paper, a shade deeper than the page, lit from one corner. */
  muted: "border bg-muted shadow-xs",
} as const;

type InsetSectionProps = {
  tone: keyof typeof tones;
  /** The id of the heading that names this section. */
  labelledBy?: string;
  /** Classes for the page's column inside the panel, such as its padding. */
  containerClassName?: string;
  className?: string;
  children: ReactNode;
};

/**
 * A section drawn as a panel set into the page with rounded corners, like the
 * homepage's opening. The ink tone switches the tokens inside it to the dark
 * theme, so text keeps its contrast in either theme.
 */
export function InsetSection({ tone, labelledBy, containerClassName, className, children }: InsetSectionProps) {
  const theme = tone === "ink" ? { "data-theme": "dark" } : {};

  return (
    <section aria-labelledby={labelledBy} {...theme} className={cn("px-2 py-1 sm:px-4 sm:py-2", className)}>
      <div className={cn("relative isolate overflow-clip rounded-[1.75rem] sm:rounded-[2.5rem]", tones[tone])}>
        {tone === "muted" ? <PanelLight /> : null}
        <Container className={cn("py-16 sm:py-20 lg:py-24", containerClassName)}>{children}</Container>
      </div>
    </section>
  );
}

/** Gold light from the upper corner and a cool glow low down. Carries no text. */
function PanelLight() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(55%_45%_at_100%_0%,rgb(var(--glow-gold)/0.14),transparent_70%),radial-gradient(45%_40%_at_0%_100%,rgb(var(--glow-blue)/0.08),transparent_70%)]"
    />
  );
}
