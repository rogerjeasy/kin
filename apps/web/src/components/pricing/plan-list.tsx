import type { Dictionary } from "@/i18n/dictionary";

import { PlanRow } from "./plan-row";

type PlanListProps = { copy: Dictionary["pricingPage"]["plans"] };

const HEADING_ID = "organisations-heading";

/** The plans an organisation buys, as rows: who pays, what they get, the price. */
export function PlanList({ copy }: PlanListProps) {
  const labels = [copy.whoPays, copy.whatTheyGet, copy.price];
  const { title, items } = copy.organisations;

  return (
    <div>
      <h2 id={HEADING_ID} className="font-serif text-subtitle">{title}</h2>
      {/* Visible column titles for wide screens. Each row repeats them for
          screen readers, so this copy is hidden from them. */}
      <div aria-hidden="true" className="mt-6 hidden gap-x-8 px-7 pb-3 font-mono text-xs font-medium text-muted-foreground uppercase lg:grid lg:grid-cols-[1fr_1.3fr_1.6fr_1.2fr] ltr:tracking-wider">
        <span />
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <ul aria-labelledby={HEADING_ID} className="surface mt-6 overflow-hidden rounded-3xl lg:mt-0">
        {items.map((plan) => (
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
