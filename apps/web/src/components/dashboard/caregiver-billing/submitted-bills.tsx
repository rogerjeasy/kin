import { calculateCaregiverBill } from "@kin/domain";
import type { CircleSnapshot } from "@kin/db";
import Link from "next/link";

import { Panel } from "@/components/dashboard/ui/panel";
import { dashboardRoutes } from "@/content/dashboard-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";
import { BillBreakdown } from "./bill-breakdown";
import { ReviewActions } from "./review-actions";

/** `sandbox`: the proposals PayPal's sandbox paid in a demo circle, labelled so rather than simulated. */
type Props = { circle: CircleSnapshot; locale: Locale; canReview: boolean; copy: Dictionary["dashboard"]["caregiverBilling"]; sandbox?: { readonly paid: ReadonlySet<string>; readonly tag: string } };

/** Every caregiver bill the viewer may read, with where it stands and, for a reviewer, what to do next. */
export function SubmittedBills({ circle, locale, canReview, copy, sandbox }: Props) {
  const bills = circle.bills.filter((bill) => bill.caregiverDetails !== null).toReversed();
  if (bills.length === 0) return null;
  return (
    <Panel title={copy.submittedTitle}>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {bills.map((bill) => {
          const proposal = circle.proposals.findLast((each) => each.billId === bill.id);
          return (
            <article key={bill.id} id={`caregiver-bill-${bill.id}`} className="min-w-0 scroll-mt-24 rounded-xl border p-4">
              <h3 className="font-semibold wrap-anywhere">{circle.payees.find((payee) => payee.id === bill.payeeId)?.name}</h3>
              <p className="mt-1 mb-4 text-sm text-muted-foreground">
                {proposal ? copy.proposalStates[proposal.state] : copy.states[bill.state]}
                {proposal && sandbox?.paid.has(proposal.id) ? ` · ${sandbox.tag}` : circle.circle.demo ? ` · ${copy.simulated}` : ""}
              </p>
              <BillBreakdown bill={calculateCaregiverBill(bill.caregiverDetails)} locale={locale} copy={copy} />
              {proposal ? (
                <Link href={localizedPath(locale, dashboardRoutes.approvals)} className="mt-4 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
                  {copy.followApproval}
                </Link>
              ) : canReview && bill.state === "received" ? (
                <ReviewActions billId={bill.id} copy={copy} />
              ) : null}
            </article>
          );
        })}
      </div>
    </Panel>
  );
}
