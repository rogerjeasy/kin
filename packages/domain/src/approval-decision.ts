import { ApprovalError } from "./approval-error.ts";
import {
  INDEPENDENT_APPROVER_ROLES,
  type ApprovalPlan,
  type ApprovalSlot,
} from "./approval-plan.ts";
import { isPaused } from "./pause.ts";
import type { CircleRole } from "./roles.ts";
import { wishApprovalMet, type WishApproval } from "./wishes.ts";

/** One member's recorded answer to a proposal. */
export type ApprovalVote = {
  readonly memberId: string;
  /** The member's role in the circle when they answered. */
  readonly role: CircleRole;
  readonly decision: "approve" | "reject";
};

export type PendingPlan = Extract<ApprovalPlan, { outcome: "needs_approval" }>;

export type ApprovalTally = {
  readonly plan: PendingPlan;
  readonly votes: readonly ApprovalVote[];
  /** When the circle's pause lifts, or `null` when it is not paused. */
  readonly pausedUntil: Date | null;
  readonly now: Date;
  /**
   * What the parent's wishes add while a trigger is active: a payment to a new
   * payee over her amount waits for every member she named, and for two at
   * least (`wishes.ts`). Read when the answer is given, so a proposal raised
   * before the trigger is held to it too.
   */
  readonly wishApproval?: WishApproval | null;
};

export type ApprovalDecision =
  | "approved"
  | "rejected"
  | "expired"
  | "paused"
  | "pending";

/**
 * Where a proposal stands, given every answer recorded so far. Each slot in
 * the plan needs a yes from a different member. A no from anyone whose yes
 * could count rejects the proposal. The member being paid can say yes, but
 * another member must say yes as well.
 *
 * A member holds one role in a circle, so answers that give one member two
 * roles are refused rather than read in whichever order they arrive.
 */
export function decideApprovals(tally: ApprovalTally): ApprovalDecision {
  assertOneRoleEach(tally.votes);
  const { plan, now } = tally;
  if (isPaused(tally.pausedUntil, now)) return "paused";
  if (now.getTime() >= plan.expiresAt.getTime()) return "expired";

  const wish = tally.wishApproval ?? null;
  // A member her wish names has a say, whatever the plan's slots ask: their no rejects, and their yes is needed.
  const counted = tally.votes.filter((vote) => canDecide(plan, vote) || (wish !== null && wish.memberIds.includes(vote.memberId)));
  if (counted.some((vote) => vote.decision === "reject")) return "rejected";

  const approvers = distinctApprovers(counted);
  const filled = canFill(plan.slots, approvers);
  const interested = interestedMembers(plan);
  const independent = interested.length === 0 || approvers.some((approver) => !interested.includes(approver.memberId));
  if (!filled || !independent) return "pending";
  return wish === null || wishApprovalMet(wish, counted.filter((vote) => vote.decision === "approve").map((vote) => vote.memberId), plan.payeeMemberId) ? "approved" : "pending";
}

function assertOneRoleEach(votes: readonly ApprovalVote[]): void {
  const roles = new Map<string, CircleRole>();
  for (const { memberId, role } of votes) {
    const known = roles.get(memberId);
    if (known !== undefined && known !== role) {
      throw new ApprovalError(`Member ${memberId} answered as ${known} and as ${role}`);
    }
    roles.set(memberId, role);
  }
}

function canDecide(plan: PendingPlan, vote: ApprovalVote): boolean {
  if (plan.slots.some((slot) => slot.roles.includes(vote.role))) return true;
  // When the payee is a member, or the member who raised it said where the
  // money goes, someone else must say yes, so any member who could give that
  // independent yes also has a say.
  const interested = interestedMembers(plan);
  return interested.length > 0 && !interested.includes(vote.memberId) && includesRole(INDEPENDENT_APPROVER_ROLES, vote.role);
}

/**
 * The members whose yes alone can never complete a plan: the member being
 * paid (section 7.5, rule 7) and the member who raised a payment and said
 * where it goes. The same principle, so one rule holds both.
 */
export function interestedMembers(plan: PendingPlan): string[] {
  return [plan.payeeMemberId, plan.raiserMemberId ?? null].filter((memberId): memberId is string => memberId !== null);
}

function includesRole(roles: readonly CircleRole[], role: CircleRole): boolean {
  return roles.includes(role);
}

type Approver = { readonly memberId: string; readonly role: CircleRole };

function distinctApprovers(votes: readonly ApprovalVote[]): Approver[] {
  const byMember = new Map<string, Approver>();
  for (const { memberId, role } of votes) byMember.set(memberId, { memberId, role });
  return [...byMember.values()];
}

// Each slot takes a different approver. Plans hold at most a few slots and a
// circle a few members, so trying every assignment is cheap and never misses
// one that a greedy choice would.
function canFill(
  slots: readonly ApprovalSlot[],
  approvers: readonly Approver[],
): boolean {
  const [slot, ...rest] = slots;
  if (slot === undefined) return true;
  return approvers.some(
    (approver, index) =>
      slot.roles.includes(approver.role) &&
      canFill(rest, approvers.filter((_, other) => other !== index)),
  );
}
