import type { CircleSnapshot } from "@kin/db";

import { LetterBillNext } from "@/components/dashboard/letters/letter-bill-next";
import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";
import { Tag } from "@/components/shared/tag";
import type { InvoiceView } from "@/content/open-kin/invoice-views";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { DeclineInvoiceButton } from "./decline-invoice-button";
import { InvoiceLines } from "./invoice-lines";

type Props = {
  invoice: InvoiceView;
  circle: CircleSnapshot;
  format: Formatters;
  mayReview: boolean;
  approvalsHref: string;
  copy: Dictionary["dashboard"]["bills"]["invoices"];
  billCopy: Dictionary["dashboard"]["letters"]["bills"];
  sampleLabel: string;
};

const TONES: Partial<Record<NonNullable<InvoiceView["billState"]>, PillTone>> = { needs_review: "waiting", ready: "waiting", proposed: "waiting", paid: "positive", rejected: "neutral" };

/** One invoice an agency sent: its lines checked against the calendar, where it stands, and what comes next for it. */
export function AgencyInvoiceCard({ invoice, circle, format, mayReview, approvalsHref, copy, billCopy, sampleLabel }: Props) {
  const bill = circle.bills.find((each) => each.id === invoice.billId);
  const flagged = invoice.lines.filter((line) => line.flags.length > 0).length;
  const state = invoice.billState;
  const stateLabel = state === "rejected" ? copy.declined : state !== null && state in billCopy.states ? billCopy.states[state as keyof typeof billCopy.states] : null;
  const memberName = (memberId: string) => circle.members.find((member) => member.id === memberId)?.displayName ?? "";
  return (
    <li className="grid min-w-0 gap-3 rounded-2xl border bg-card p-4 sm:p-5" aria-label={fill(copy.heading, { agency: invoice.agency, number: invoice.number })}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-60">
          <h3 className="font-semibold text-balance wrap-anywhere">{fill(copy.heading, { agency: invoice.agency, number: invoice.number })}</h3>
          <p className="text-sm text-muted-foreground">{[invoice.period, invoice.due].filter((part) => part !== "").join(" · ")}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {invoice.seeded ? <Tag>{sampleLabel}</Tag> : null}
          {state !== null && stateLabel !== null ? <StatusPill tone={TONES[state] ?? "neutral"}>{stateLabel}</StatusPill> : null}
          <span className="font-serif text-xl tabular-nums">{invoice.total}</span>
        </div>
      </div>
      <p className={flagged > 0 ? "text-sm font-medium text-danger" : "text-sm font-medium text-positive"}>
        {flagged > 0 ? fill(copy.warning, { count: format.count(flagged), total: format.count(invoice.lines.length) }) : copy.allClear}
      </p>
      <InvoiceLines lines={invoice.lines} copy={copy} />
      <p className="text-sm text-pretty text-muted-foreground">
        {invoice.paypalEmail === null ? copy.noPaypal : fill(copy.paypal, { email: invoice.paypalEmail })} {copy.lessThanInvoiced}
      </p>
      {bill ? (
        <div className="grid min-w-0 gap-2 empty:hidden">
          <LetterBillNext bill={bill} circle={circle} payeeName={invoice.agency} format={format} mayReview={mayReview} approvalsHref={approvalsHref} memberName={memberName} copy={billCopy} receiver={invoice.paypalEmail} />
          {mayReview && bill.state === "needs_review" ? <DeclineInvoiceButton billId={bill.id} label={copy.decline} pendingLabel={copy.declining} errors={billCopy.errors} /> : null}
        </div>
      ) : null}
    </li>
  );
}
