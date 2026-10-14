import type { ReactNode } from "react";

type Step = { title: string; text: string };

type StepListProps = {
  steps: readonly Step[];
  /** Extra content shown under the last step. */
  afterLast?: ReactNode;
};

/** Numbered steps separated by hairlines. */
export function StepList({ steps, afterLast }: StepListProps) {
  return (
    <ol>
      {steps.map((step, index) => (
        <li key={step.title} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 border-t py-5">
          <span aria-hidden="true" className="pt-0.5 font-mono text-sm text-muted-foreground tabular-nums">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">{step.title}</h3>
            <p className="mt-1 text-muted-foreground">{step.text}</p>
            {index === steps.length - 1 ? afterLast : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
