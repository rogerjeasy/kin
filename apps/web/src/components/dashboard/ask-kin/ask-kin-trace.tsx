import { CheckIcon, CircleSlashIcon } from "lucide-react";

import type { Dictionary } from "@/i18n/dictionary";

import type { AskKinAnswer } from "./use-ask-kin";

type Props = { steps: AskKinAnswer["steps"]; copy: Dictionary["askKin"]["answer"] };

/**
 * The tools Kin called, in order, and what became of each: the visible proof
 * that the model chose what to look up and that Kin's gateway decided what ran.
 */
export function AskKinTrace({ steps, copy }: Props) {
  return (
    <details open className="min-w-0 rounded-xl border bg-background">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{copy.trace}</summary>
      {steps.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">{copy.traceEmpty}</p>
      ) : (
        <ol className="space-y-2 px-4 pb-4">
          {steps.map((step, index) => {
            const Icon = step.outcome === "ok" ? CheckIcon : CircleSlashIcon;
            return (
              <li key={`${step.tool}-${index}`} className="flex min-w-0 items-start gap-3 text-sm">
                <span aria-hidden="true" className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 wrap-anywhere">
                  <span className="font-medium">{step.label}</span>
                  <span className="block text-muted-foreground">
                    <Icon aria-hidden="true" className="me-1 inline size-3.5 align-[-2px]" />
                    {step.outcomeLabel} · <code className="text-xs">{step.tool}</code>
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
