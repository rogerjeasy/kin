import { INDEPENDENT_APPROVER_ROLES, decideApprovals, interestedMembers, type ApprovalDecision, type ApprovalSlot, type PendingPlan } from "@kin/domain";
import type { CircleSnapshot, ProposalRecord, VoteRecord } from "@kin/db";

export type SlotView = {
  /** The plan's place, or `independent`: the yes still owed by someone other than the member paid or the one who raised it. */
  readonly reason: ApprovalSlot["reason"] | "independent";
  /** The yes that fills this place, or `null` while it is open. */
  readonly filledBy: VoteRecord | null;
  /** Who could still fill it, by member ID. Empty once it is filled. */
  readonly waitingFor: readonly string[];
};

export type ProposalView = {
  readonly proposal: ProposalRecord;
  readonly plan: PendingPlan;
  /** Where the proposal stands, as the approval engine decides it. */
  readonly decision: ApprovalDecision;
  readonly slots: readonly SlotView[];
  /** The viewer's yes would fill a place that is still open. */
  readonly viewerCanAnswer: boolean;
};

/**
 * A proposal as the approvals screen shows it. The plan is the one the
 * approval engine made when the proposal was raised, and the decision is the
 * engine's on the circle's clock. Matching each yes to a place is only for
 * display: it never decides whether the proposal is approved.
 */
export function proposalView(circle: CircleSnapshot, proposal: ProposalRecord): ProposalView | null {
  const { plan } = proposal;
  if (plan.outcome !== "needs_approval") return null;
  const decision = decideApprovals({ plan, votes: proposal.votes, pausedUntil: circle.circle.pausedUntil, now: circle.circle.now });
  const slots = matchVotes(circle, plan, proposal.votes);
  const { viewer } = circle;
  const answered = proposal.votes.some((each) => each.memberId === viewer.memberId);
  const viewerCanAnswer = !answered && slots.some((slot) => slot.filledBy === null && slot.waitingFor.includes(viewer.memberId));
  return { proposal, plan, decision, slots, viewerCanAnswer };
}

function matchVotes(circle: CircleSnapshot, plan: PendingPlan, votes: readonly VoteRecord[]): SlotView[] {
  const yeses = votes.filter((each) => each.decision === "approve");
  const voted = new Set(votes.map((each) => each.memberId));
  const used = new Set<string>();
  const active = circle.members.filter((member) => member.status === "active");

  const slots: SlotView[] = plan.slots.map((slot) => {
    const filledBy = yeses.find((each) => !used.has(each.memberId) && slot.roles.includes(each.role)) ?? null;
    if (filledBy) {
      used.add(filledBy.memberId);
      return { reason: slot.reason, filledBy, waitingFor: [] };
    }
    const waitingFor = active
      .filter((member) => slot.roles.includes(member.role))
      .filter((member) => !voted.has(member.id) && member.id !== plan.payeeMemberId)
      .map((member) => member.id);
    return { reason: slot.reason, filledBy: null, waitingFor };
  });
  // Every place is filled, but only by those whose yes alone cannot complete it: one more is owed, by anyone else who shares the cost.
  const interested = interestedMembers(plan);
  const owed = interested.length > 0 && slots.every((slot) => slot.filledBy !== null) && !yeses.some((each) => !interested.includes(each.memberId));
  if (!owed) return slots;
  const roles: readonly string[] = INDEPENDENT_APPROVER_ROLES;
  const waitingFor = active.filter((member) => roles.includes(member.role) && !voted.has(member.id) && !interested.includes(member.id)).map((member) => member.id);
  return [...slots, { reason: "independent", filledBy: null, waitingFor }];
}

/**
 * Every proposal still waiting for its approvals, as the approvals screen
 * shows it. A pause holds them without closing them, so they stay listed.
 */
export function waitingProposals(circle: CircleSnapshot): ProposalView[] {
  return circle.proposals.flatMap((proposal) => {
    if (proposal.state !== "pending_approval") return [];
    const view = proposalView(circle, proposal);
    return view !== null && (view.decision === "pending" || view.decision === "paused") ? [view] : [];
  });
}
