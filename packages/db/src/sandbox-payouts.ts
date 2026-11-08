import type { SandboxSkipReason } from "@kin/domain";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import type { Transaction } from "./connection.ts";
import { audit, type PayoutJob } from "./payouts.ts";
import { approvals, auditLog, executions, proposals } from "./schema/index.ts";

/**
 * A demo circle's caregiver payout paid for real through PayPal's sandbox,
 * to Kin's own sandbox test account (docs/architecture.md section 20). The
 * choice is written to the audit log, append-only, in the transaction that
 * readies the payout: it is what later turns read to keep tracking the
 * payout at PayPal, and what counts this circle's sandbox payouts.
 */
export const SANDBOX_ROUTED = "payout.sandbox";
const SANDBOX_SKIPPED = "payout.sandbox_skipped";
const SANDBOX_FALLBACK = "payout.sandbox_fallback";

/** The Kin sandbox address this execution was routed to, or `null` when it was never sent to the sandbox. */
export async function readSandboxRoute(tx: Transaction, job: Pick<PayoutJob, "circleId" | "executionId">): Promise<{ readonly receiver: string } | null> {
  const [row] = await tx
    .select({ details: auditLog.details })
    .from(auditLog)
    .where(and(eq(auditLog.circleId, job.circleId), eq(auditLog.subjectId, job.executionId), eq(auditLog.action, SANDBOX_ROUTED)))
    .limit(1);
  const receiver = (row?.details as { receiver?: unknown } | undefined)?.receiver;
  return typeof receiver === "string" && receiver !== "" ? { receiver } : null;
}

/**
 * What the sandbox route needs to know of the circle's own record: whether
 * the approval engine approved the proposal on a member's recorded yes, and
 * how many of the circle's other payouts already went to the sandbox.
 */
export async function readSandboxFacts(tx: Transaction, job: PayoutJob): Promise<{ readonly approved: boolean; readonly circlePayouts: number }> {
  const [proposal] = await tx
    .select({ yes: sql<string>`count(${approvals.id})` })
    .from(proposals)
    .leftJoin(approvals, and(eq(approvals.circleId, proposals.circleId), eq(approvals.proposalId, proposals.id), eq(approvals.decision, "approve")))
    .where(and(eq(proposals.circleId, job.circleId), eq(proposals.id, job.proposalId), inArray(proposals.state, ["approved", "executing"])))
    .groupBy(proposals.id);
  const [routed] = await tx
    .select({ count: sql<string>`count(*)` })
    .from(auditLog)
    .where(and(eq(auditLog.circleId, job.circleId), eq(auditLog.action, SANDBOX_ROUTED), ne(auditLog.subjectId, job.executionId)));
  return { approved: Number(proposal?.yes ?? 0) > 0, circlePayouts: Number(routed?.count ?? 0) };
}

/** Routes the payout to the sandbox, once. The address is fixed on the execution when it has none yet. */
export async function markSandboxPayout(tx: Transaction, job: PayoutJob, receiver: string): Promise<void> {
  await audit(tx, job, SANDBOX_ROUTED, { receiver });
  await tx.update(executions).set({ receiver }).where(and(eq(executions.id, job.executionId), isNull(executions.receiver)));
}

/** Why a demo payout stayed simulated though the sandbox was configured. */
export async function recordSandboxSkipped(tx: Transaction, job: PayoutJob, reason: SandboxSkipReason): Promise<void> {
  await audit(tx, job, SANDBOX_SKIPPED, { reason });
}

/** PayPal's sandbox would not pay it, so the demo pays it simulated instead, and says why. */
export async function recordSandboxFallback(tx: Transaction, job: PayoutJob, reason: string): Promise<void> {
  await tx.update(executions).set({ lastError: reason }).where(eq(executions.id, job.executionId));
  await audit(tx, job, SANDBOX_FALLBACK, { reason });
}
