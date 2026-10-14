import type { Dictionary } from "@/i18n/dictionary";

import { PlanRow } from "./plan-row";

type PlanListProps = { copy: Dictionary["pricingPage"]["plans"] };

export function PlanList({ copy }: PlanListProps) {
  const labels = [copy.whoPays, copy.whatTheyGet, copy.price];

  return (
    <div>
      {/* Visible column titles for wide screens. Each row repeats them for
          screen readers, so this copy is hidden from them. */}
      <div aria-hidden="true" className="hidden gap-x-8 pb-3 text-sm text-muted-foreground lg:grid lg:grid-cols-[1fr_1.3fr_1.6fr_1.2fr]">
        <span />
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <ul aria-label={copy.label} className="border-b">
        {copy.items.map((plan) => (
          <PlanRow
            key={plan.name}
            name={plan.name}
            details={[
              { label: copy.whoPays, value: plan.whoPays },
              { label: copy.whatTheyGet, value: plan.whatTheyGet },
              { label: copy.price, value: plan.price },
            ]}
          />
        ))}
      </ul>
    </div>
  );
}
