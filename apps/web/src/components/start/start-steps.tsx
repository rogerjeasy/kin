import type { Dictionary } from "@/i18n/dictionary";

type StartStepsProps = { copy: Dictionary["startPage"]["steps"] };

/** The four steps of starting a circle, by name. */
export function StartSteps({ copy }: StartStepsProps) {
  return (
    <div className="surface rounded-2xl p-5">
      <h2 className="inline-flex items-center gap-2.5 text-sm font-medium text-muted-foreground uppercase ltr:tracking-widest">
        <span aria-hidden="true" className="h-px w-5 bg-gold" />
        {copy.eyebrow}
      </h2>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {copy.items.map((step, index) => (
          <li key={step.title} className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 rounded-xl border bg-background/60 px-3 py-2.5">
            <span aria-hidden="true" className="grid size-8 place-items-center rounded-full border border-gold/50 bg-gold/10 font-mono text-xs font-medium text-highlight tabular-nums">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="font-semibold">{step.title}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
