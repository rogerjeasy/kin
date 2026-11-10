import type { ParentSubscriptionRecord } from "@kin/db";
import { PauseCircleIcon, PlayCircleIcon, RepeatIcon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { AddSubscriptionForm } from "./add-subscription-form";

type Props = {
  readonly copy: Dictionary["dashboard"]["wishes"];
  readonly parent: string;
  readonly subscriptions: readonly ParentSubscriptionRecord[];
  readonly format: Formatters;
  readonly canAdd: boolean;
  /** A demo circle's subscriptions are simulated and name no PayPal subscription. */
  readonly demo: boolean;
};

/** What the parent pays each month that her wishes can pause, and where each stands. */
export function SubscriptionsPanel({ copy, parent, subscriptions, format, canAdd, demo }: Props) {
  const text = copy.subscriptions;
  return (
    <Panel title={fill(text.title, { parent })} description={text.text}>
      {subscriptions.length === 0 ? <p className="text-muted-foreground">{text.empty}</p> : null}
      <ul className="flex min-w-0 flex-col divide-y">
        {subscriptions.map((subscription) => {
          const Icon = subscription.state === "active" ? PlayCircleIcon : subscription.state === "suspended" ? PauseCircleIcon : RepeatIcon;
          return (
            <li key={subscription.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1 basis-40">
                <p className="font-semibold break-words">{subscription.name}</p>
                <p className="text-sm text-muted-foreground">{fill(text.monthly, { amount: format.money(subscription.monthlyCents) })}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusPill tone={subscription.state === "active" ? "positive" : "waiting"} icon={Icon}>
                  {text.states[subscription.state]}
                </StatusPill>
                {subscription.simulated ? <StatusPill tone="neutral">{copy.simulated}</StatusPill> : null}
                {!subscription.simulated && !subscription.linked ? <StatusPill tone="neutral">{text.notLinked}</StatusPill> : null}
              </div>
            </li>
          );
        })}
      </ul>
      {canAdd ? <AddSubscriptionForm copy={copy} demo={demo} /> : null}
    </Panel>
  );
}
