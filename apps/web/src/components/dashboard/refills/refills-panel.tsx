import { ClockIcon, PackageCheckIcon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import { DELIVERY_STEPS, anyOnTheWay, type OrderView, type RuleView } from "@/content/circle/refills";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { DeliveryTrack } from "./delivery-track";
import { KeepLooking } from "./keep-looking";
import { RefillButton } from "./refill-button";

type Props = {
  copy: Dictionary["dashboard"]["refills"];
  format: Formatters;
  rules: readonly RuleView[];
  orders: readonly OrderView[];
  sellerName: (payeeId: string) => string;
  /** A demo circle's purchases are simulated, and the screen says so. */
  simulated: boolean;
  /** Whether the viewer may ask Kin to reorder at all, for the note when they may not. */
  mayAsk: boolean;
};

const REFRESH_SECONDS = 15;

// A state this screen has no words for reads as waiting, the one it can always be.
function proposalStatusWords(copy: Props["copy"], state: string): string {
  const words: Readonly<Record<string, string>> = copy.proposalStates;
  return words[state] ?? copy.proposalStates.pending_approval;
}

/**
 * The refills Kin may propose for the family and where each order is. The
 * button asks Kin to propose; the purchase waits on the Approvals list for
 * the yes the agreement asks for, and its delivery shows here once bought.
 */
export function RefillsPanel({ copy, format, rules, orders, sellerName, simulated, mayAsk }: Props) {
  if (rules.length === 0 && orders.length === 0) return null;
  const steps = DELIVERY_STEPS.map((key) => ({ key, label: copy.states[key] }));
  return (
    <section aria-labelledby="refills-heading" className="space-y-4">
      <h2 id="refills-heading" className="text-lg font-semibold">
        {copy.title}
      </h2>
      <p className="max-w-3xl text-sm text-muted-foreground">{copy.lede}</p>
      {anyOnTheWay(orders) ? <KeepLooking seconds={REFRESH_SECONDS} /> : null}
      {rules.map(({ rule, remainingCents, askable }) => (
        <Panel
          key={rule.id}
          title={rule.item}
          description={fill(copy.rule, { seller: sellerName(rule.payeeId), price: format.money(rule.priceCents), limit: format.money(rule.limitCents) })}
          aside={<StatusPill tone="neutral">{fill(copy.budget, { left: format.money(remainingCents), budget: format.money(rule.monthlyBudgetCents) })}</StatusPill>}
        >
          {askable ? (
            <RefillButton ruleId={rule.id} label={copy.ask} working={copy.asking} asked={copy.asked} reasons={copy.reasons} />
          ) : (
            <p className="text-sm text-muted-foreground">{mayAsk ? copy.alreadyAsked : copy.cannotAsk}</p>
          )}
        </Panel>
      ))}
      {orders.length > 0 ? (
        <Panel title={copy.ordersTitle} description={simulated ? copy.simulated : undefined}>
          <ul className="space-y-5">
            {orders.map(({ purchase, proposalState }) => (
              <li key={purchase.id} className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 font-medium text-balance">
                    {purchase.item} · <span className="tabular-nums">{format.money(purchase.cents)}</span>
                  </p>
                  {purchase.state === "delivered" ? (
                    <StatusPill tone="positive" icon={PackageCheckIcon}>{copy.states.delivered}</StatusPill>
                  ) : proposalState === "settled" ? null : (
                    <StatusPill tone="waiting" icon={ClockIcon}>{proposalStatusWords(copy, proposalState)}</StatusPill>
                  )}
                </div>
                {proposalState === "settled" ? <DeliveryTrack steps={steps} current={purchase.state} label={copy.trackLabel} /> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <p className="text-sm text-muted-foreground">{copy.ordersEmpty}</p>
      )}
    </section>
  );
}
