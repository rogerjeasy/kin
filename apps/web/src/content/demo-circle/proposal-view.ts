import { decideApprovals, type ApprovalDecision, type ApprovalSlot, type PendingPlan } from "@kin/domain";

import type { CircleMember } from "../circle-portraits";
import { planFor } from "./approval-request";
import { DEMO_NOW } from "./clock";
import { VIEWER, demoMembers, type DemoMember } from "./members";
import { demoProposals, payeeOf, type DemoProposal, type DemoVote } from "./proposals";

export type SlotView = {
  readonly reason: ApprovalSlot["reason"];
  /** The yes that fills this place, or `null` while it is open. */
  readonly filledBy: DemoVote | null;
  /** Who could still fill it. Empty once it is filled. */
  readonly waitingFor: readonly CircleMember[];
};

export type ProposalView = {
  readonly proposal: DemoProposal;
  readonly plan: PendingPlan;
  /** Where the proposal stands, as the approval engine decides it. */
  readonly decision: ApprovalDecision;
  readonly slots: readonly SlotView[];
  /** The viewer's yes would fill a place that is still open. */
  readonly viewerCanAnswer: boolean;
};

/**
 * A proposal as the approvals screen shows it. The plan and the decision come
 * from the approval engine. Matching each yes to a place is only for display:
 * it never decides whether the proposal is approved.
 */
export function proposalView(proposal: DemoProposal, viewer: DemoMember = VIEWER, now: Date = DEMO_NOW): ProposalView {
  const plan = planFor(proposal.kind, proposal.cents, payeeOf(proposal), proposal.raisedAt);
  if (plan.outcome !== "needs_approval") {
    throw new Error(`The demo proposal ${proposal.id} does not wait for approval`);
  }
  const decision = decideApprovals({ plan, votes: proposal.votes, pausedUntil: null, now });
  const slots = matchVotes(plan, proposal.votes);
  const answered = proposal.votes.some((each) => each.memberId === viewer.id);
  const viewerCanAnswer =
    !answered && slots.some((slot) => slot.filledBy === null && slot.waitingFor.includes(viewer.id));

  return { proposal, plan, decision, slots, viewerCanAnswer };
}

function matchVotes(plan: PendingPlan, votes: readonly DemoVote[]): SlotView[] {
  const yeses = votes.filter((each) => each.decision === "approve");
  const voted = new Set(votes.map((each) => each.memberId));
  const used = new Set<string>();

  return plan.slots.map((slot) => {
    const filledBy = yeses.find((each) => !used.has(each.memberId) && slot.roles.includes(each.role)) ?? null;
    if (filledBy) {
      used.add(filledBy.memberId);
      return { reason: slot.reason, filledBy, waitingFor: [] };
    }
    const waitingFor = demoMembers
      .filter((member) => slot.roles.includes(member.role))
      .filter((member) => !voted.has(member.id) && member.id !== plan.payeeMemberId)
      .map((member) => member.id);
    return { reason: slot.reason, filledBy: null, waitingFor };
  });
}

/** Every proposal waiting on the demo clock, as the approvals screen shows it. */
export function waitingProposals(): ProposalView[] {
  return demoProposals.map((proposal) => proposalView(proposal)).filter((view) => view.decision === "pending");
}
