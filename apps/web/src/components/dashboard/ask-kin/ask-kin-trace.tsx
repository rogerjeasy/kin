import { CheckIcon, ChevronDownIcon, CircleSlashIcon } from "lucide-react";

import type { Dictionary } from "@/i18n/dictionary";
import { cn } from "@/lib/utils";

import type { AskKinAnswer } from "./use-ask-kin";

type Props = { steps: AskKinAnswer["steps"]; copy: Dictionary["askKin"]["answer"] };

/**
 * The tools Kin called, in order, and what became of each: the visible proof
 * that the model chose what to look up and that Kin's gateway decided what ran.
 */
export function AskKinTrace({ steps, copy }: Props) {
  return (
    <details open className="group min-w-0 rounded-2xl border bg-card/60">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{copy.trace}</span>
        <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-180" />
      </summary>
      {steps.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">{copy.traceEmpty}</p>
      ) : (
        <ol className="enter-stagger px-4 pb-4">
          {steps.map((step, index) => {
            const ok = step.outcome === "ok";
            const Icon = ok ? CheckIcon : CircleSlashIcon;
            return (
              <li key={`${step.tool}-${index}`} className="relative flex min-w-0 items-start gap-3 pb-4 text-sm last:pb-0">
                <span aria-hidden="true" className="absolute start-3 top-7 bottom-0 w-px bg-border in-[li:last-child]:hidden" />
                <span aria-hidden="true" className={cn("relative grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums ring-1", ok ? "bg-gold/20 text-highlight ring-gold/50 shadow-[0_0_10px_-2px_rgb(var(--glow-gold)/0.7)]" : "bg-secondary text-muted-foreground ring-border")}>
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 wrap-anywhere">
                  <span className="font-medium">{step.label}</span>
                  <span className="block text-muted-foreground">
                    <Icon aria-hidden="true" className="me-1 inline size-3.5 align-[-2px]" />
                    {step.outcomeLabel} · <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">{step.tool}</code>
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </details>
  );
}
