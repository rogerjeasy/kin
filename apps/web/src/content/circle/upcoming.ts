import { planApprovals, type ApprovalPlan, type ProposalKind } from "@kin/domain";
import type { CircleSnapshot } from "@kin/db";

import { parentLevelOf } from "./members";

export type UpcomingView = {
  readonly id: string;
  readonly payeeId: string;
  readonly kind: ProposalKind;
  /** What the family expects it to cost. The real amount comes with the bill. */
  readonly expectedCents: number;
  /** YYYY-MM-DD. */
  readonly due: string;
  readonly category: string;
  /** What the approval engine will ask for, or `null` when the person may not see the agreement. */
  readonly plan: ApprovalPlan | null;
};

/** The bills the family expects, each with what the approval engine will ask for. */
export function upcomingBills(circle: CircleSnapshot): UpcomingView[] {
  return circle.expectedBills.flatMap((bill) => {
    const payee = circle.payees.find((each) => each.id === bill.payeeId);
    if (!payee) return [];
    const plan =
      circle.agreement === null
        ? null
        : planApprovals({
            kind: bill.kind,
            cents: bill.expectedCents,
            payee: payee.payee,
            agreement: circle.agreement,
            parentLevel: parentLevelOf(circle),
            pausedUntil: circle.circle.pausedUntil,
            now: circle.circle.now,
          });
    return [{ id: bill.id, payeeId: bill.payeeId, kind: bill.kind, expectedCents: bill.expectedCents, due: bill.dueOn, category: payee.category, plan }];
  });
}
