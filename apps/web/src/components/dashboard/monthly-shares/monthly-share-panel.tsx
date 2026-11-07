import { TOP_UP_LIMITS } from "@kin/domain";
import type { CircleSnapshot } from "@kin/db";

import { Panel } from "@/components/dashboard/ui/panel";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { may } from "@/server/dashboard-context";
import { topUpServices } from "@/server/paypal";

import { ShareControls } from "./share-controls";
import { ShareList, type ShareItem } from "./share-list";

type Props = { locale: Locale; dictionary: Dictionary; circle: CircleSnapshot; checkOnLoad: boolean };

/**
 * Every member's monthly share, open to everyone who sees the circle's money,
 * and the viewer's own to start, pause, resume or end where this deployment
 * has PayPal. Past shares that ended are not listed.
 */
export function MonthlySharePanel({ locale, dictionary, circle, checkOnLoad }: Props) {
  if (!may(circle, "money.view")) return null;
  const copy = dictionary.dashboard.monthly;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const portraits = new Map(circle.members.map((member) => [member.id, member.portrait]));
  const live = circle.monthlyShares.filter((share) => share.state !== "cancelled");
  const mine = live.find((share) => share.memberId === circle.viewer.memberId) ?? null;
  const mineState = mine === null || mine.state === "cancelled" ? null : mine.state;
  const limits = TOP_UP_LIMITS[circle.circle.currency];
  const canManage = topUpServices() !== null && limits !== undefined && may(circle, "money.contribute");
  const items: ShareItem[] = live.map((share) => ({
    id: share.id,
    portrait: portraits.get(share.memberId) ?? null,
    name: names.member(share.memberId),
    amount: fill(copy.perMonth, { amount: format.money(share.cents) }),
    state: share.state,
    stateLabel: copy.states[share.state],
    badge: share.simulated ? dictionary.dashboard.common.simulated : null,
    notes: [
      share.state === "active" && share.nextBillingAt !== null ? fill(copy.next, { date: format.dateTime(share.nextBillingAt) }) : null,
      share.failedPayments > 0 ? fill(copy.failedCharges, { count: format.count(share.failedPayments) }) : null,
    ].filter((note) => note !== null),
  }));

  return (
    <Panel title={copy.title} description={copy.text} flush>
      {items.length === 0 ? <p className="px-5 pb-4 text-sm text-muted-foreground sm:px-6">{copy.empty}</p> : <ShareList items={items} />}
      {canManage && limits !== undefined ? (
        <div className="border-t px-5 py-4 sm:px-6">
          <ShareControls
            copy={copy}
            currency={circle.circle.currency}
            limits={{ min: format.money(limits.minCents), max: format.money(limits.maxCents) }}
            share={mine === null || mineState === null ? null : { state: mineState, approvalUrl: mine.approvalUrl }}
            demo={circle.circle.demo}
            checkOnLoad={checkOnLoad}
          />
        </div>
      ) : null}
    </Panel>
  );
}
