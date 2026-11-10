import { FileCheckIcon, SparklesIcon, UserCheckIcon } from "lucide-react";

import type { Dictionary } from "@/i18n/dictionary";

import { IconBadge } from "./icon-badge";

const steps = [
  { key: "proposes", icon: SparklesIcon },
  { key: "approves", icon: UserCheckIcon },
  { key: "decides", icon: FileCheckIcon },
] as const;

type PrincipleChainProps = { copy: Dictionary["principle"] };

/** The rule behind every payment, as three lit cards on one line of gold, in the order they happen. */
export function PrincipleChain({ copy }: PrincipleChainProps) {
  return (
    <ol aria-label={copy.label} className="relative grid gap-3 md:grid-cols-3">
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-[10%] top-[2.875rem] hidden h-px bg-linear-to-r from-gold/10 via-gold/70 to-gold/10 md:block" />
      {steps.map((step, index) => (
        <li key={step.key} className="surface lift glow-edge min-w-0 rounded-3xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <IconBadge icon={step.icon} className="border border-gold/40 shadow-[0_0_18px_-2px_rgb(var(--glow-gold)/0.5)]" />
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
