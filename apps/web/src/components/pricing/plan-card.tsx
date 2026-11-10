import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { RisingFigure } from "@/components/motion/rising-figure";
import { cn } from "@/lib/utils";

const tones = {
  page: "surface lift glow-edge",
  /** The family's plan: a small ink panel of its own, lit like the hero. */
  band: "aurora relative overflow-clip text-foreground shadow-xl ring-1 ring-gold/40 lg:-translate-y-3",
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
  // The ink card switches the tokens inside it to the dark theme, so its text keeps its contrast.
  const theme = tone === "band" ? { "data-theme": "dark" } : {};

  return (
    <li {...theme} className={cn("flex min-w-0 flex-col rounded-3xl p-6 sm:p-8", tones[tone])}>
      {tone === "band" ? (
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-gold to-transparent" />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-lg font-semibold">{plan.name}</h2>
        {badge ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-xs font-medium text-highlight">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-gold" />
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mt-7 font-serif text-figure text-balance ltr:tracking-tight">
        <RisingFigure value={plan.price} />
      </p>
      <p className="mt-1 text-muted-foreground">{plan.priceNote}</p>
      <p className="mt-6 border-t pt-5 font-medium">{plan.whoPays}</p>
      <p className="mt-6 font-mono text-xs font-medium text-muted-foreground uppercase ltr:tracking-widest">{includes}</p>
      <ul className="mt-3 space-y-2.5">
        {plan.features.map((feature) => (
          <li key={feature} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
            <span aria-hidden="true" className="mt-1 grid size-5 place-items-center rounded-full bg-gold/15">
              <CheckIcon className="size-3.5 text-highlight" />
            </span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {children ? <div className="mt-auto pt-8">{children}</div> : null}
    </li>
  );
}
