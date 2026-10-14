import type { Dictionary } from "@/i18n/dictionary";

type StartStepsProps = { copy: Dictionary["startPage"]["steps"] };

/** The four steps of starting a circle, by name. */
export function StartSteps({ copy }: StartStepsProps) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <h2 className="text-sm font-medium text-muted-foreground uppercase ltr:tracking-widest">{copy.eyebrow}</h2>
      <ol className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {copy.items.map((step, index) => (
          <li key={step.title} className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2">
            <span aria-hidden="true" className="pt-0.5 font-mono text-sm font-medium text-highlight tabular-nums">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="font-semibold">{step.title}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
