import type { ReactNode } from "react";

type Step = { title: string; text: string };

type StepListProps = {
  steps: readonly Step[];
  /** Extra content shown under the last step. */
  afterLast?: ReactNode;
};

/** Numbered steps on a line of gold light that runs from the first to the last. */
export function StepList({ steps, afterLast }: StepListProps) {
  return (
    <ol>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li key={step.title} className="relative grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-4 pb-8 last:pb-0">
            {last ? null : (
              <span
                aria-hidden="true"
                className="absolute start-[1.375rem] top-12 bottom-1 w-px bg-linear-to-b from-gold to-gold/10"
              />
            )}
            <span
              aria-hidden="true"
              className="relative grid size-11 place-items-center rounded-full border border-gold/60 bg-card font-mono text-sm font-medium text-highlight tabular-nums shadow-[0_0_14px_1px_rgb(var(--glow-gold)/0.3)]"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 pt-2">
              <h3 className="text-lg font-semibold">{step.title}</h3>
              <p className="mt-1 text-muted-foreground">{step.text}</p>
              {last ? afterLast : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
