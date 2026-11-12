import type { BillState } from "@kin/domain";
import type { CircleSnapshot } from "@kin/db";

import { ProvenanceBadge } from "@/components/dashboard/ai/provenance-badge";
import { PayeeCell } from "@/components/dashboard/bills/payee-cell";
import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";
import { storedProvenance } from "@/lib/provenance";

import { LetterBillNext } from "./letter-bill-next";

type Props = {
  circle: CircleSnapshot;
  locale: Locale;
  copy: Dictionary["dashboard"]["letters"];
  ai: Dictionary["aiProvenance"];
  /** Whether the viewer may confirm a bill and say how it is paid: the members who share the cost. */
  mayReview: boolean;
  approvalsHref: string;
};

type ShownState = keyof Dictionary["dashboard"]["letters"]["bills"]["states"];
const TONES: Readonly<Record<ShownState, PillTone>> = { needs_review: "waiting", extracted: "waiting", duplicate: "neutral", ready: "waiting", proposed: "waiting", paid: "positive" };
const shown = (state: BillState): state is ShownState => Object.hasOwn(TONES, state);

/** The bills Kin put on the list from a letter, with where each stands and what comes next for it. */
export function LetterBills({ circle, locale, copy, ai, mayReview, approvalsHref }: Props) {
  const format = formatters(locale, circle.circle.currency);
  const bills = circle.bills.filter((bill) => bill.caregiverDetails === null && bill.documentId !== null).toReversed();
  const memberName = (memberId: string) => circle.members.find((member) => member.id === memberId)?.displayName ?? "";
  return (
    <Panel title={copy.bills.title}>
      {bills.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.bills.empty}</p>
      ) : (
        <ul className="min-w-0 divide-y">
          {bills.map((bill) => {
            const payeeName = circle.payees.find((each) => each.id === bill.payeeId)?.name ?? "";
            const provenance = storedProvenance(circle.documents.find((each) => each.id === bill.documentId)?.extraction);
            return (
              <li key={bill.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0" aria-label={payeeName}>
                <PayeeCell name={payeeName} detail={bill.dueOn === null ? undefined : fill(copy.bills.due, { day: format.day(bill.dueOn) })} />
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  {shown(bill.state) ? <StatusPill tone={TONES[bill.state]}>{copy.bills.states[bill.state]}</StatusPill> : null}
                  <span className="font-serif text-xl tabular-nums">{format.money(bill.amountCents)}</span>
                </div>
                {provenance === null ? null : <div className="basis-full"><ProvenanceBadge provenance={provenance} kind="read" copy={ai} /></div>}
                <div className="min-w-0 basis-full empty:hidden">
                  <LetterBillNext bill={bill} circle={circle} payeeName={payeeName} format={format} mayReview={mayReview} approvalsHref={approvalsHref} memberName={memberName} copy={copy.bills} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
