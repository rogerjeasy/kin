import type { BillRecord, CircleSnapshot } from "@kin/db";
import { calendarDay, decimalAmount } from "@kin/domain";
import Link from "next/link";

import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { BillReviewForm } from "./bill-review-form";
import { PaidOutsideForm } from "./paid-outside-form";

type Props = {
  bill: BillRecord;
  circle: CircleSnapshot;
  payeeName: string;
  format: Formatters;
  /** Whether the viewer may confirm bills and record one paid outside Kin. */
  mayReview: boolean;
  approvalsHref: string;
  memberName: (memberId: string) => string;
  copy: Dictionary["dashboard"]["letters"]["bills"];
};

/** What comes next for one bill read from a letter: its review, its wait for the family's yes, or its payment outside Kin. */
export function LetterBillNext({ bill, circle, payeeName, format, mayReview, approvalsHref, memberName, copy }: Props) {
  if (bill.state === "needs_review") {
    if (!mayReview) return null;
    const amount = decimalAmount({ cents: bill.amountCents, currency: circle.circle.currency });
    return <BillReviewForm billId={bill.id} name={payeeName} amount={amount} dueOn={bill.dueOn} copy={copy} />;
  }
  if (bill.state === "proposed") {
    return (
      <p className="text-sm text-pretty text-muted-foreground">
        {copy.proposedText}{" "}
        <Link href={approvalsHref} className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4">{copy.approvalsLink}</Link>
      </p>
    );
  }
  if (bill.state !== "ready") return null;
  const recorded = circle.receipts.find((receipt) => receipt.billId === bill.id && receipt.state !== "rejected");
  return (
    <div className="grid min-w-0 gap-2">
      <p className="text-sm font-medium">{bill.dueOn === null ? copy.outside.noDue : fill(copy.outside.due, { day: format.day(bill.dueOn) })}</p>
      {recorded ? (
        <p className="text-sm text-pretty text-muted-foreground">{fill(copy.outside.waiting, { name: memberName(recorded.memberId) })}</p>
      ) : mayReview ? (
        <PaidOutsideForm billId={bill.id} today={calendarDay(circle.circle.now, circle.circle.timezone).occurredOn} copy={copy} />
      ) : null}
    </div>
  );
}
