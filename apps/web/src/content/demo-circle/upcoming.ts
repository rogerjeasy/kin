import type { ApprovalPlan, ProposalKind } from "@kin/domain";

import { planFor } from "./approval-request";
import { DEMO_NOW } from "./clock";
import { demoPayees, type PayeeId } from "./payees";

export type UpcomingBill = {
  readonly payeeId: PayeeId;
  readonly kind: ProposalKind;
  /** What the family expects it to cost. The real amount comes with the bill. */
  readonly expectedCents: number;
  /** YYYY-MM-DD. */
  readonly due: string;
};

const upcoming: readonly UpcomingBill[] = [
  { payeeId: "gas", kind: "bill_payment", expectedCents: 5700, due: "2026-11-02" },
  { payeeId: "electricity", kind: "bill_payment", expectedCents: 8400, due: "2026-11-03" },
  { payeeId: "amara", kind: "caregiver_payout", expectedCents: 26400, due: "2026-11-06" },
  { payeeId: "pharmacy", kind: "purchase", expectedCents: 4200, due: "2026-11-09" },
];

export type UpcomingView = UpcomingBill & { readonly category: string; readonly plan: ApprovalPlan };

/** November's expected bills, each with what the approval engine will ask for. */
export function upcomingBills(): UpcomingView[] {
  return upcoming.map((bill) => {
    const { payee, category } = demoPayees[bill.payeeId];
    return { ...bill, category, plan: planFor(bill.kind, bill.expectedCents, payee, DEMO_NOW) };
  });
}
