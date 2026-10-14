import type { ReactNode } from "react";

export type TraceStep = { label: string; body: ReactNode };

type TraceStepsProps = {
  /** Names the whole sequence for a screen reader. */
  label: string;
  steps: readonly TraceStep[];
};

/** A short sequence read left to right: what came in, what was checked, what followed. */
export function TraceSteps({ label, steps }: TraceStepsProps) {
  return (
    <ol aria-label={label} className="grid divide-y rounded-2xl border bg-card md:grid-cols-3 md:divide-x md:divide-y-0">
      {steps.map((step) => (
        <li key={step.label} className="min-w-0 px-6 py-5">
          <p className="text-xs font-medium text-muted-foreground uppercase ltr:tracking-wider">{step.label}</p>
          <div className="mt-2">{step.body}</div>
        </li>
      ))}
    </ol>
  );
}
