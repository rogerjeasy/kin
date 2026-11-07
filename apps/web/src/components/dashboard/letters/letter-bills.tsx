import type { CircleSnapshot } from "@kin/db";

import { PayeeCell } from "@/components/dashboard/bills/payee-cell";
import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";

type Props = { circle: CircleSnapshot; locale: Locale; copy: Dictionary["dashboard"]["letters"] };

/** The bills Kin put on the list from a letter, with where each stands. None is paid from here. */
export function LetterBills({ circle, locale, copy }: Props) {
  const format = formatters(locale, circle.circle.currency);
  const bills = circle.bills.filter((bill) => bill.caregiverDetails === null && bill.documentId !== null).toReversed();
  return (
    <Panel title={copy.bills.title}>
      {bills.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.bills.empty}</p>
      ) : (
        <ul className="min-w-0 divide-y">
          {bills.map((bill) => {
            const payee = circle.payees.find((each) => each.id === bill.payeeId);
            const state = bill.state === "duplicate" || bill.state === "extracted" || bill.state === "needs_review" ? bill.state : null;
            return (
              <li key={bill.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <PayeeCell name={payee?.name ?? ""} detail={bill.dueOn === null ? undefined : fill(copy.bills.due, { day: format.day(bill.dueOn) })} />
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  {state === null ? null : <StatusPill tone={state === "duplicate" ? "neutral" : "waiting"}>{copy.bills.states[state]}</StatusPill>}
                  <span className="font-semibold tabular-nums">{format.money(bill.amountCents)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
