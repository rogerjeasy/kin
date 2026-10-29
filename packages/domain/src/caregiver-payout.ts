import type { Agreement } from "./agreement.ts";
import { planApprovals, type ApprovalPlan, type Payee } from "./approval-plan.ts";
import { calculateCaregiverBill } from "./caregiver-bill.ts";
import type { ParentLevel } from "./roles.ts";

/** The purpose key every proposal raised from a caregiver's bill carries. */
export const CAREGIVER_BILL_PURPOSE = "caregiver_bill";

export type CaregiverPayoutRequest = {
  /** The bill's stored service-day snapshot, parsed again here. */
  readonly details: unknown;
  /** The amount stored on the bill, which must equal the snapshot's total. */
  readonly billCents: number;
  readonly payee: Payee;
  readonly agreement: Pick<Agreement, "version" | "approvals">;
  readonly parentLevel: ParentLevel;
  readonly pausedUntil: Date | null;
  readonly now: Date;
};

export type CaregiverPayoutPlan = { readonly cents: number; readonly plan: ApprovalPlan };

/** The bill cannot become a proposal. Retrying the same bill cannot help. */
export class CaregiverPayoutError extends Error {
  readonly retryable = false;
  readonly reason: "amount_mismatch" | "not_a_caregiver";

  constructor(reason: CaregiverPayoutError["reason"]) {
    super(`A caregiver bill cannot be proposed: ${reason}`);
    this.name = "CaregiverPayoutError";
    this.reason = reason;
  }
}

/**
 * Who must say yes before a caregiver's bill is paid. The amount is the
 * evidence's own total, never a figure typed by whoever sends it, and the
 * caregiver is the payee member, so they can never be the only yes.
 */
export function planCaregiverPayout(request: CaregiverPayoutRequest): CaregiverPayoutPlan {
  const bill = calculateCaregiverBill(request.details);
  if (bill.cents !== request.billCents) throw new CaregiverPayoutError("amount_mismatch");
  if (request.payee.member?.role !== "caregiver") throw new CaregiverPayoutError("not_a_caregiver");
  const plan = planApprovals({
    kind: "caregiver_payout",
    cents: bill.cents,
    payee: request.payee,
    agreement: request.agreement,
    parentLevel: request.parentLevel,
    pausedUntil: request.pausedUntil,
    now: request.now,
  });
  return { cents: bill.cents, plan };
}
