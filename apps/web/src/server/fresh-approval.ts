import { assessStepUp, type Session } from "@kin/auth";
import { ProposalClosedError, answerProposal, asPerson } from "@kin/db";

import type { Notice } from "@/content/dashboard-notices";

import { circleOf } from "./circle";
import { may } from "./dashboard-context";
import { databases } from "./database";

/**
 * Records a person's yes to a real payment, after they signed in again for
 * it. The yes counts only if the token Cognito just issued proves a second
 * factor completed in the last few minutes; that proof is stored with the
 * answer, and the approval engine decides as for any other answer.
 */
export async function approveWithFreshCheck(session: Session, proposalId: string, now: Date): Promise<Notice> {
  const verdict = assessStepUp(session.authentication, now);
  if (!verdict.fresh) return verdict.reason === "stale" ? "stepUpStale" : "stepUpMissing";
  const circle = await circleOf({ kind: "person", userId: session.userId, session });
  // The demo's money is simulated and is answered without a step-up.
  if (circle === null || circle.circle.demo || !may(circle, "proposal.answer")) return "refused";
  const seat = { circleId: circle.circle.id, memberId: circle.viewer.memberId, role: circle.viewer.role };
  try {
    const decision = await asPerson(databases().app, session.userId, (tx) =>
      answerProposal(tx, seat, { proposalId, decision: "approve", method: "app", evidenceRef: verdict.evidence, now: circle.circle.now, pausedUntil: circle.circle.pausedUntil }),
    );
    return decision === "approved" ? "approved" : decision === "rejected" ? "rejected" : "answered";
  } catch (error) {
    if (error instanceof ProposalClosedError) return "closed";
    throw error;
  }
}
