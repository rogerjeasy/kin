import { FileCheckIcon, SparklesIcon, UserCheckIcon } from "lucide-react";

import type { Dictionary } from "@/i18n/dictionary";

import { IconBadge } from "./icon-badge";

const steps = [
  { key: "proposes", icon: SparklesIcon },
  { key: "approves", icon: UserCheckIcon },
  { key: "decides", icon: FileCheckIcon },
] as const;

type PrincipleChainProps = { copy: Dictionary["principle"] };

/** The rule behind every payment, as three steps in the order they happen. */
export function PrincipleChain({ copy }: PrincipleChainProps) {
  return (
    <ol aria-label={copy.label} className="grid divide-y rounded-3xl border bg-card md:grid-cols-3 md:divide-x md:divide-y-0">
      {steps.map((step, index) => (
        <li key={step.key} className="min-w-0 p-6 sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <IconBadge icon={step.icon} />
            <span aria-hidden="true" className="font-mono text-sm font-medium text-highlight tabular-nums">
              {String(index + 1).padStart(2, "0")}
            </span>
          </div>
          <h2 className="mt-5 font-serif text-2xl">{copy.steps[step.key].title}</h2>
          <p className="mt-1.5 text-muted-foreground">{copy.steps[step.key].text}</p>
        </li>
      ))}
    </ol>
  );
}
