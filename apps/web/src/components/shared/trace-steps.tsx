import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type TraceStep = { label: string; body: ReactNode };

type TraceStepsProps = {
  /** Names the whole sequence for a screen reader. */
  label: string;
  steps: readonly TraceStep[];
};

/**
 * A short sequence read left to right: what came in, what was checked, what
 * followed. Drawn as three lit cards on one line of gold, the last one glowing.
 */
export function TraceSteps({ label, steps }: TraceStepsProps) {
  return (
    <ol aria-label={label} className="relative grid gap-3 md:grid-cols-3 md:gap-4">
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-[8%] top-1/2 hidden h-px bg-linear-to-r from-gold/10 via-gold/70 to-gold/10 md:block" />
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li
            key={step.label}
            className={cn("surface min-w-0 rounded-2xl px-5 py-5 sm:px-6", last && "border-gold/50 shadow-[0_12px_40px_-16px_rgb(var(--glow-gold)/0.55)]")}
          >
            <p className="flex items-center gap-2.5 text-xs font-medium text-muted-foreground uppercase ltr:tracking-wider">
              <span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded-full border font-mono text-[0.625rem] tabular-nums", last ? "border-gold bg-gold/15 text-highlight" : "border-input")}>
                {index + 1}
              </span>
              {step.label}
            </p>
            <div className="mt-3">{step.body}</div>
          </li>
        );
      })}
    </ol>
  );
}
