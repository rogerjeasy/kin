import { decideApprovals, wishApprovalFor, type ApprovalDecision, type CircleRole } from "@kin/domain";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Transaction } from "./connection.ts";
import { parseApprovalPlan } from "./plan-json.ts";
import { approvals, auditLog, circles, invitations, proposals } from "./schema/index.ts";
import type { ApprovalMethod } from "./values.ts";
import { readWishEffects } from "./wishes.ts";

/** The proposal has already been decided, or is not one the person can answer. */
export class ProposalClosedError extends Error {
  readonly retryable = false;

  constructor(proposalId: string) {
    super(`Proposal ${proposalId} is no longer waiting for answers`);
    this.name = "ProposalClosedError";
  }
}

export type Seat = { readonly circleId: string; readonly memberId: string; readonly role: CircleRole };

type Answer = {
  readonly proposalId: string;
  readonly decision: "approve" | "reject";
  readonly method: ApprovalMethod;
  /** What proves the answer: in a real circle, a yes needs the fresh multi-factor check. */
  readonly evidenceRef?: string | null;
  /** The circle's clock, which the approval engine decides on. */
  readonly now: Date;
  readonly pausedUntil: Date | null;
};

/**
 * Records a member's answer and lets the approval engine decide where the
 * proposal now stands. The proposal row is locked while it decides, so two
 * answers at once cannot both read the old state. Run inside `asPerson`:
 * row-level security checks the member answers in their own seat and role.
 */
export async function answerProposal(tx: Transaction, seat: Seat, answer: Answer): Promise<ApprovalDecision> {
  const locked = await tx.execute<{ state: string; plan: unknown; cents: string; payee_status: "approved" | "new" | null }>(
    sql`select p.state, p.plan, p.cents, (select status from payees where circle_id = p.circle_id and id = p.payee_id) as payee_status
        from proposals p where p.id = ${answer.proposalId} and p.circle_id = ${seat.circleId} for update of p`,
  );
  const row = locked.rows[0];
  if (!row || row.state !== "pending_approval") throw new ProposalClosedError(answer.proposalId);
  const plan = parseApprovalPlan(row.plan);
  if (plan.outcome !== "needs_approval") throw new ProposalClosedError(answer.proposalId);

  const given = await tx.select({ memberId: approvals.memberId, role: approvals.role, decision: approvals.decision }).from(approvals).where(eq(approvals.proposalId, answer.proposalId));
  await tx.insert(approvals).values({
    id: randomUUID(),
    circleId: seat.circleId,
    proposalId: answer.proposalId,
    memberId: seat.memberId,
    role: seat.role,
    decision: answer.decision,
    method: answer.method,
    evidenceRef: answer.evidenceRef ?? null,
    decidedAt: answer.now,
  });
  // While a trigger is active, the parent's wishes may ask more people before a new payee is paid.
  const wishApproval = wishApprovalFor(await readWishEffects(tx, seat.circleId), { cents: Number(row.cents), payeeStatus: row.payee_status });
  const decision = decideApprovals({ plan, votes: [...given, { memberId: seat.memberId, role: seat.role, decision: answer.decision }], pausedUntil: answer.pausedUntil, now: answer.now, wishApproval });
  if (decision === "approved" || decision === "rejected" || decision === "expired") {
    await tx.update(proposals).set({ state: decision }).where(and(eq(proposals.id, answer.proposalId), eq(proposals.circleId, seat.circleId)));
  }
  await record(tx, seat, "proposal.answered", "proposal", answer.proposalId, { decision: answer.decision, outcome: decision, method: answer.method, ...(wishApproval === null ? {} : { wishIds: wishApproval.wishIds }) });
  return decision;
}

/** Holds every approval for the circle until `until`, in the member's name. */
export async function pauseCircle(tx: Transaction, seat: Seat, until: Date): Promise<void> {
  await tx.update(circles).set({ pausedUntil: until, pausedBy: seat.memberId }).where(eq(circles.id, seat.circleId));
  await record(tx, seat, "circle.paused", "circle", seat.circleId, { until: until.toISOString() });
}

/** Lifts the pause early. The organizer or the member who paused may. */
export async function resumeCircle(tx: Transaction, seat: Seat): Promise<void> {
  await tx.update(circles).set({ pausedUntil: null, pausedBy: null }).where(eq(circles.id, seat.circleId));
  await record(tx, seat, "circle.resumed", "circle", seat.circleId, {});
}

/** Records an organizer's invitation of someone to a role. */
export async function inviteMember(tx: Transaction, seat: Seat, invitation: { email: string; role: CircleRole; expiresAt: Date }): Promise<string> {
  const id = randomUUID();
  await tx.insert(invitations).values({ id, circleId: seat.circleId, email: invitation.email, role: invitation.role, invitedBy: seat.memberId, expiresAt: invitation.expiresAt });
  await record(tx, seat, "member.invited", "invitation", id, { role: invitation.role });
  return id;
}

async function record(tx: Transaction, seat: Seat, action: string, subjectType: string, subjectId: string, details: Record<string, unknown>): Promise<void> {
  await tx.insert(auditLog).values({ id: randomUUID(), circleId: seat.circleId, actor: "member", memberId: seat.memberId, action, subjectType, subjectId, details, origin: "web" });
}
