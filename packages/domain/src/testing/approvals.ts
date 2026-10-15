import type { ApprovalTerms } from "../agreement.ts";
import type { ApprovalVote } from "../approval-decision.ts";
import {
  PROPOSAL_KINDS,
  type ApprovalRequest,
  type Payee,
} from "../approval-plan.ts";
import { CIRCLE_ROLES, PARENT_LEVELS, type CircleRole } from "../roles.ts";
import type { Random } from "./property.ts";

export const NOW = new Date("2026-10-14T12:00:00Z");

/** Rose's family's terms: she decides above 50.00, two agree above 500.00. */
export const TERMS: ApprovalTerms = {
  ceilingCents: 300000,
  secondApprovalAboveCents: 50000,
  parentDecidesAboveCents: 5000,
};

export const KNOWN_BILLER: Payee = { status: "approved", member: null, autoPay: null };

export function approvalRequest(
  overrides: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  return {
    kind: "bill_payment",
    cents: 8400,
    payee: KNOWN_BILLER,
    agreement: { version: 4, approvals: TERMS },
    parentLevel: "informed",
    pausedUntil: null,
    now: NOW,
    ...overrides,
  };
}

export const vote = (
  memberId: string,
  role: CircleRole,
  decision: ApprovalVote["decision"] = "approve",
): ApprovalVote => ({ memberId, role, decision });

/** Any request the engine accepts, often near a threshold. */
export function randomApprovalRequest(random: Random): ApprovalRequest {
  const terms: ApprovalTerms = {
    ceilingCents: random.int(0, 1_000_000),
    secondApprovalAboveCents: random.int(0, 1_000_000),
    parentDecidesAboveCents: random.int(0, 1_000_000),
  };
  const near = random.pick([
    terms.ceilingCents,
    terms.secondApprovalAboveCents,
    terms.parentDecidesAboveCents,
  ]);
  const cents = Math.max(1, near + random.int(-2, 2));
  const kind = random.pick(PROPOSAL_KINDS);
  const minCents = random.int(0, 1_000_000);
  return {
    kind,
    cents: random.pick([cents, random.int(1, 2_000_000)]),
    payee: {
      status: random.pick(["approved", "new"] as const),
      member:
        kind === "member_payout" || random.int(0, 1) === 1
          ? { memberId: `member-${random.int(0, 4)}`, role: random.pick(CIRCLE_ROLES) }
          : null,
      autoPay:
        random.int(0, 1) === 1
          ? { ruleId: "rule", minCents, maxCents: minCents + random.int(0, 1_000_000) }
          : null,
    },
    agreement: { version: random.int(1, 9), approvals: terms },
    parentLevel: random.pick(PARENT_LEVELS),
    pausedUntil:
      random.int(0, 3) === 0
        ? new Date(NOW.getTime() + random.int(-2, 2) * 3_600_000)
        : null,
    now: NOW,
  };
}

/** Six members, each holding one role, as a member does in a circle. */
export function randomMembers(random: Random): CircleRole[] {
  return Array.from({ length: 6 }, () => random.pick(CIRCLE_ROLES));
}

/** Up to eight answers from the members, by `member-<index>`. */
export function randomVotes(
  random: Random,
  members: readonly CircleRole[],
): ApprovalVote[] {
  return Array.from({ length: random.int(0, 8) }, () => {
    const index = random.int(0, members.length - 1);
    return vote(
      `member-${index}`,
      members[index] ?? "observer",
      random.pick(["approve", "approve", "reject"] as const),
    );
  });
}
