import type { CircleSnapshot } from "@kin/db";

import { Panel } from "@/components/dashboard/ui/panel";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";

import { HearButton } from "./hear-button";
import { VerdictPill } from "./verdict-pill";

type Props = {
  circle: CircleSnapshot;
  locale: Locale;
  copy: Dictionary["dashboard"]["letters"];
  speech: Dictionary["dashboard"]["speech"] | null;
};

const SHOWN = 5;

/**
 * The demands Kin has checked, newest first, each with its verdict. Every
 * member who sees the circle's money sees the same list: that is how the
 * whole circle is told, and each can hear what Kin told them.
 */
export function RecentChecks({ circle, locale, copy, speech }: Props) {
  const format = formatters(locale, circle.circle.currency);
  const told = new Set(circle.narrations.filter((each) => each.memberId === circle.viewer.memberId).map((each) => each.claimCheckId));
  const checks = circle.claimChecks.slice(0, SHOWN);
  return (
    <Panel title={copy.recent.title}>
      {checks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.recent.empty}</p>
      ) : (
        <ul className="min-w-0 divide-y">
          {checks.map((check) => (
            <li key={check.id} className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <VerdictPill verdict={check.verdict} payeeId={check.payeeId} labels={copy.check.verdicts} />
                <span className="text-sm text-muted-foreground">{format.day(check.checkedOn)}</span>
                {check.claimedCents === null ? null : <span className="text-sm text-muted-foreground">{fill(copy.recent.amount, { amount: format.money(check.claimedCents) })}</span>}
              </div>
              <p className="wrap-anywhere text-sm">{check.claim}</p>
              {speech && told.has(check.id) ? <HearButton label={copy.recent.hear} speaking={copy.read.hearing} request={{ kind: "claim", claimCheckId: check.id }} locale={locale} speech={speech} /> : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
