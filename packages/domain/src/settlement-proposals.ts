import type { Agreement } from "./agreement.ts";
import { planApprovals, type ApprovalPlan } from "./approval-plan.ts";
import type { CircleRole, ParentLevel } from "./roles.ts";
import type { Settlement } from "./settle-period.ts";

/** The purpose key every proposal raised from a settlement carries. */
export const SETTLEMENT_PURPOSE = "settlement";

export type SettlementPayoutRequest = {
  readonly settlement: Settlement;
  /** The role of every active member who may be paid. */
  readonly roles: ReadonlyMap<string, CircleRole>;
  readonly agreement: Pick<Agreement, "version" | "approvals">;
  readonly parentLevel: ParentLevel;
  readonly pausedUntil: Date | null;
  readonly now: Date;
};

/** One member's payout, with who must say yes to it. */
export type SettlementPayout = {
  readonly memberId: string;
  /** What the pool can pay now: never above what the member is owed, never above the cash that has arrived. */
  readonly cents: number;
  readonly plan: Extract<ApprovalPlan, { outcome: "needs_approval" }>;
};

/** The settlement cannot be put to the family. Retrying cannot help until something changes. */
export class SettlementProposalError extends Error {
  readonly retryable = false;
  readonly reason: "paused" | "above_ceiling" | "not_a_member";

  constructor(reason: SettlementProposalError["reason"]) {
    super(`A settlement cannot be proposed: ${reason}`);
    this.name = "SettlementProposalError";
    this.reason = reason;
  }
}

/**
 * Turns a period's settlement into the payouts the family must approve, one
 * for each member the pool can pay something now. A payout is planned by the
 * same approval engine as every other movement of money, and the member being
 * paid can never be the only yes. The part of a payout the pool cannot cover
 * waits for the collections and is not proposed.
 */
export function planSettlementPayouts(request: SettlementPayoutRequest): SettlementPayout[] {
  return request.settlement.plan.payouts
    .filter((payout) => payout.releasableCents > 0)
    .map((payout) => {
      const role = request.roles.get(payout.memberId);
      if (role === undefined) throw new SettlementProposalError("not_a_member");
      const plan = planApprovals({
        kind: "member_payout",
        cents: payout.releasableCents,
        payee: { status: "approved", member: { memberId: payout.memberId, role }, autoPay: null },
        agreement: request.agreement,
        parentLevel: request.parentLevel,
        pausedUntil: request.pausedUntil,
        now: request.now,
      });
      if (plan.outcome === "paused") throw new SettlementProposalError("paused");
      // A standing rule belongs to bills, so a member payout never reaches one.
      if (plan.outcome !== "needs_approval") throw new SettlementProposalError("above_ceiling");
      return { memberId: payout.memberId, cents: payout.releasableCents, plan };
    });
}
