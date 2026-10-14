import type { Agreement, ApprovalTerms } from "./agreement.ts";
import { ApprovalError } from "./approval-error.ts";
import { assertCents } from "./money.ts";
import { isPaused } from "./pause.ts";
import type { CircleRole, ParentLevel } from "./roles.ts";

/** The movements of money a proposal can ask for. */
export const PROPOSAL_KINDS = [
  "bill_payment",
  "caregiver_payout",
  "member_payout",
  "purchase",
] as const;

export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/** How long a proposal waits for its approvals before it expires. */
export const APPROVAL_WINDOW_HOURS = 72;

/** Members who can give the approval that is not the payee's own. */
export const INDEPENDENT_APPROVER_ROLES = [
  "organizer",
  "contributor",
] as const satisfies readonly CircleRole[];

/** A payee's standing permission to be paid without a new approval. */
export type AutoPayRule = {
  readonly ruleId: string;
  /** The expected range of the recurring bill, both ends included. */
  readonly minCents: number;
  readonly maxCents: number;
};

export type Payee = {
  readonly status: "approved" | "new";
  /** Set when the money goes to a member of the circle. */
  readonly member: { readonly memberId: string; readonly role: CircleRole } | null;
  readonly autoPay: AutoPayRule | null;
};

export type ApprovalRequest = {
  readonly kind: ProposalKind;
  readonly cents: number;
  readonly payee: Payee;
  readonly agreement: Pick<Agreement, "version" | "approvals">;
  readonly parentLevel: ParentLevel;
  /** When the circle's pause lifts, or `null` when it is not paused. */
  readonly pausedUntil: Date | null;
  readonly now: Date;
};

/** One yes the proposal needs, from a distinct member holding one of `roles`. */
export type ApprovalSlot = {
  readonly reason: "parent_decides" | "organizer" | "second_approval";
  readonly roles: readonly CircleRole[];
};

export type ApprovalPlan =
  | { readonly outcome: "paused"; readonly until: Date }
  | { readonly outcome: "refused"; readonly reason: "above_ceiling" }
  | {
      readonly outcome: "standing_rule";
      readonly ruleId: string;
      readonly agreementVersion: number;
    }
  | {
      readonly outcome: "needs_approval";
      readonly slots: readonly ApprovalSlot[];
      /** The member being paid, who may not be the only one to say yes. */
      readonly payeeMemberId: string | null;
      /** A new payee is announced to the whole circle. */
      readonly announceToCircle: boolean;
      readonly expiresAt: Date;
    };

const HOUR_MS = 60 * 60 * 1000;

/**
 * Decides who must say yes before a movement of money may execute, by the
 * rules of docs/architecture.md section 7.5, applied in order.
 */
export function planApprovals(request: ApprovalRequest): ApprovalPlan {
  assertRequest(request);
  const { cents, payee, agreement, now } = request;
  const terms = agreement.approvals;

  if (request.pausedUntil !== null && isPaused(request.pausedUntil, now)) {
    return { outcome: "paused", until: request.pausedUntil };
  }
  if (cents > terms.ceilingCents) {
    return { outcome: "refused", reason: "above_ceiling" };
  }
  const autoPay = standingRule(request);
  if (autoPay !== null) {
    return {
      outcome: "standing_rule",
      ruleId: autoPay.ruleId,
      agreementVersion: agreement.version,
    };
  }
  return {
    outcome: "needs_approval",
    slots: slotsFor(cents, request.parentLevel, terms),
    payeeMemberId: payee.member?.memberId ?? null,
    announceToCircle: payee.status === "new",
    expiresAt: new Date(now.getTime() + APPROVAL_WINDOW_HOURS * HOUR_MS),
  };
}

// Only a recurring bill from a payee the family already approved, inside the
// range they expect, is paid on a standing rule. A new payee never is.
function standingRule({ kind, cents, payee }: ApprovalRequest): AutoPayRule | null {
  const rule = payee.autoPay;
  if (kind !== "bill_payment" || payee.status !== "approved" || rule === null) {
    return null;
  }
  return cents >= rule.minCents && cents <= rule.maxCents ? rule : null;
}

function slotsFor(
  cents: number,
  parentLevel: ParentLevel,
  terms: ApprovalTerms,
): ApprovalSlot[] {
  const parentDecides =
    parentLevel === "decides" && cents > terms.parentDecidesAboveCents;
  const first: ApprovalSlot = parentDecides
    ? { reason: "parent_decides", roles: ["parent"] }
    : { reason: "organizer", roles: ["organizer"] };
  if (cents <= terms.secondApprovalAboveCents) return [first];
  return [first, { reason: "second_approval", roles: INDEPENDENT_APPROVER_ROLES }];
}

function assertRequest({ kind, cents, payee, agreement }: ApprovalRequest): void {
  assertCents(cents);
  if (cents <= 0) {
    throw new ApprovalError(`A movement must be above zero, got ${cents}`);
  }
  if (kind === "member_payout" && payee.member === null) {
    throw new ApprovalError("A member payout must name the member it pays");
  }
  const terms = agreement.approvals;
  for (const limit of [
    terms.ceilingCents,
    terms.secondApprovalAboveCents,
    terms.parentDecidesAboveCents,
  ]) {
    assertCents(limit);
    if (limit < 0) throw new ApprovalError(`A limit cannot be negative, got ${limit}`);
  }
  const rule = payee.autoPay;
  if (rule !== null) {
    assertCents(rule.minCents);
    assertCents(rule.maxCents);
    if (rule.minCents < 0 || rule.minCents > rule.maxCents) {
      throw new ApprovalError(`Auto-pay rule ${rule.ruleId} has no valid range`);
    }
  }
}
