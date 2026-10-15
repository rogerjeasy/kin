import { planApprovals, rosesMonth, type ApprovalPlan, type Payee, type ProposalKind } from "@kin/domain";

import { ROSE_LEVEL } from "./members";

/**
 * Asks the approval engine who must say yes to a movement in Rose's circle,
 * under the agreement her family accepted. The circle is not paused.
 */
export function planFor(kind: ProposalKind, cents: number, payee: Payee, raisedAt: Date): ApprovalPlan {
  return planApprovals({
    kind,
    cents,
    payee,
    agreement: rosesMonth.agreement,
    parentLevel: ROSE_LEVEL,
    pausedUntil: null,
    now: raisedAt,
  });
}
