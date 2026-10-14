import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const tones = {
  page: { card: "border bg-card", quiet: "text-muted-foreground", mark: "text-highlight", rule: "border-border", badge: "bg-secondary text-muted-foreground" },
  band: { card: "bg-band text-band-foreground", quiet: "text-band-muted", mark: "text-band-highlight", rule: "border-band-border", badge: "bg-band-border text-band-foreground" },
} as const;

type PlanCardProps = {
  plan: { name: string; price: string; priceNote: string; whoPays: string; features: readonly string[] };
  /** The word above the feature list. */
  includes: string;
  badge?: string;
  /** The band tone marks the plan a family would choose. */
  tone?: keyof typeof tones;
  /** The way onward from this plan, pinned to the foot of the card. */
  children?: ReactNode;
};

/** One proposed plan: who pays, how much, and what it includes. */
export function PlanCard({ plan, includes, badge, tone = "page", children }: PlanCardProps) {
  const colours = tones[tone];

  return (
    <li className={cn("flex min-w-0 flex-col rounded-3xl p-6 sm:p-8", colours.card)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-lg font-semibold">{plan.name}</h2>
        {badge ? <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", colours.badge)}>{badge}</span> : null}
      </div>
      <p className="mt-6 font-serif text-figure text-balance ltr:tracking-tight">{plan.price}</p>
      <p className={colours.quiet}>{plan.priceNote}</p>
      <p className={cn("mt-5 border-t pt-5 font-medium", colours.rule)}>{plan.whoPays}</p>
      <p className={cn("mt-5 font-mono text-xs font-medium uppercase ltr:tracking-widest", colours.quiet)}>{includes}</p>
      <ul className="mt-3 space-y-2.5">
        {plan.features.map((feature) => (
          <li key={feature} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
            <CheckIcon aria-hidden="true" className={cn("mt-1 size-4", colours.mark)} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {children ? <div className="mt-auto pt-8">{children}</div> : null}
    </li>
  );
}
