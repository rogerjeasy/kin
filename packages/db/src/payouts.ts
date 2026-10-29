import { billApproved, calendarDay, canPayOut, isPaused, payoutConfirmed, type ExecutionState } from "@kin/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Database, Transaction } from "./connection.ts";
import { readAccountIds, readLedger, writeEntries } from "./ledger-store.ts";
import { auditLog, bills, circles, executions, ledgerEntries, outbox, payees, proposals } from "./schema/index.ts";

/** The outbox topic that asks the worker to pay an approved caregiver payout. */
export const PAYOUT_TOPIC = "payout.execute";

/** One approved payout, as the worker needs it. Read inside the circle's service scope. */
export type PayoutJob = {
  readonly executionId: string;
  readonly circleId: string;
  readonly proposalId: string;
  readonly billId: string | null;
  readonly payeeId: string;
  readonly category: string;
  /** The PayPal email the money goes to, fixed on the execution, or `null` while none is known. */
  readonly receiver: string | null;
  /** The payee's address now, used only to fix a receiver the execution does not have yet. */
  readonly payeeReceiver: string | null;
  readonly cents: number;
  readonly currency: string;
  /** PayPal sees this as the batch ID, so the payout is made at most once. */
  readonly idempotencyKey: string;
  readonly state: ExecutionState;
  readonly batchId: string | null;
  /** A demo circle's payout is simulated: no PayPal call, and labelled so. */
  readonly simulated: boolean;
  /** The circle's clock: the demo's, or the real time. */
  readonly now: Date;
  readonly timezone: string;
  /** While the circle is paused, nothing new is sent to PayPal (docs/architecture.md section 15.3). */
  readonly pausedUntil: Date | null;
};

export type ClaimedMessage = { readonly id: string; readonly circleId: string; readonly payload: unknown; readonly attempts: number };

/** Leases up to `limit` unsent outbox messages of one topic, across circles. As Kin's service only. */
export async function claimOutbox(db: Database, topic: string, limit: number, leaseSeconds: number): Promise<ClaimedMessage[]> {
  const result = await db.execute<{ id: string; circle_id: string; payload: unknown; attempts: number }>(
    sql`select * from kin_private.claim_outbox(${topic}, ${limit}, ${leaseSeconds})`,
  );
  return result.rows.map((row) => ({ id: row.id, circleId: row.circle_id, payload: row.payload, attempts: row.attempts }));
}

/** The message is done with: it is never handed out again. */
export async function finishMessage(tx: Transaction, messageId: string): Promise<void> {
  await tx.update(outbox).set({ sentAt: sql`now()` }).where(eq(outbox.id, messageId));
}

/** The message is handed out again after `seconds`. */
export async function retryMessageLater(tx: Transaction, messageId: string, seconds: number): Promise<void> {
  await tx.update(outbox).set({ availableAt: sql`now() + make_interval(secs => ${seconds})` }).where(eq(outbox.id, messageId));
}

/** The execution and everything around it, locked for this transaction. `null` if it is not this circle's. */
export async function readPayoutJob(tx: Transaction, executionId: string, realNow: Date): Promise<PayoutJob | null> {
  const [row] = await tx
    .select({
      executionId: executions.id,
      circleId: executions.circleId,
      proposalId: executions.proposalId,
      idempotencyKey: executions.idempotencyKey,
      state: executions.state,
      batchId: executions.paypalBatchId,
      cents: proposals.cents,
      billId: proposals.billId,
      payeeId: proposals.payeeId,
      kind: proposals.kind,
      category: payees.category,
      receiver: executions.receiver,
      payeeReceiver: payees.paypalReceiver,
      currency: circles.currency,
      demo: circles.demo,
      clockAt: circles.clockAt,
      timezone: circles.timezone,
      pausedUntil: circles.pausedUntil,
    })
    .from(executions)
    .innerJoin(proposals, and(eq(proposals.circleId, executions.circleId), eq(proposals.id, executions.proposalId)))
    .innerJoin(payees, and(eq(payees.circleId, proposals.circleId), eq(payees.id, proposals.payeeId)))
    .innerJoin(circles, eq(circles.id, executions.circleId))
    .where(eq(executions.id, executionId))
    .for("update", { of: executions });
  if (!row || row.payeeId === null || row.kind !== "caregiver_payout") return null;
  return {
    executionId: row.executionId,
    circleId: row.circleId,
    proposalId: row.proposalId,
    billId: row.billId,
    payeeId: row.payeeId,
    category: row.category,
    receiver: row.receiver,
    payeeReceiver: row.payeeReceiver,
    cents: row.cents,
    currency: row.currency,
    idempotencyKey: row.idempotencyKey,
    state: row.state,
    batchId: row.batchId,
    simulated: row.demo,
    now: row.clockAt ?? realNow,
    timezone: row.timezone,
    pausedUntil: row.pausedUntil,
  };
}

export type BeginOutcome = "ready" | "paused" | "no_receiver" | "waiting_for_funds";

/** The address a ready payout is sent to: the one fixed on its execution. */
export function payoutReceiver(job: PayoutJob): string | null {
  return job.receiver ?? job.payeeReceiver;
}

/**
 * Readies an approved payout to be sent: the family's approval of the bill is
 * written to the ledger once (the payee is now owed), and the proposal moves
 * to executing. It stops, changing nothing, while the circle is paused, the
 * payee has no PayPal address, or the pool has not received enough money to
 * pay it and the fee.
 */
export async function beginPayout(tx: Transaction, job: PayoutJob, feeReserveCents: number): Promise<BeginOutcome> {
  if (isPaused(job.pausedUntil, job.now)) return "paused";
  if (job.receiver === null && !job.simulated) {
    // The caregiver gave no address before the family approved. Their first
    // one is fixed now, once; the database refuses to change it after.
    if (job.payeeReceiver === null) return "no_receiver";
    await tx.update(executions).set({ receiver: job.payeeReceiver }).where(and(eq(executions.id, job.executionId), isNull(executions.receiver)));
  }
  const owed = await entryExists(tx, job.circleId, "approval", job.proposalId);
  const ledger = await readLedger(tx, { id: job.circleId, currency: job.currency });
  if (!canPayOut(ledger, { cents: job.cents, feeCents: feeReserveCents, alreadyOwed: owed })) return "waiting_for_funds";
  if (!owed) {
    const entry = billApproved(
      { ...header(job, `approval`, job.proposalId), description: "Caregiver bill approved by the family" },
      { payeeId: job.payeeId, category: job.category, cents: job.cents },
    );
    await writeEntries(tx, [entry], await readAccountIds(tx, job.circleId));
  }
  await tx.update(proposals).set({ state: "executing" }).where(and(eq(proposals.id, job.proposalId), eq(proposals.state, "approved")));
  return "ready";
}

/** PayPal was asked to pay. The batch ID is `null` when its answer never came back. */
export async function recordSubmitted(tx: Transaction, job: PayoutJob, batchId: string | null, now: Date): Promise<void> {
  await moveExecution(tx, job, "created", "submitted", { paypalBatchId: batchId, submittedAt: now, attempts: sql`${executions.attempts} + 1` });
}

/** Whether PayPal paid is not known. Kin asks PayPal again; it never assumes either way. */
export async function recordUnknown(tx: Transaction, job: PayoutJob): Promise<void> {
  await moveExecution(tx, job, "submitted", "unknown", {});
  await audit(tx, job, "payout.unknown", {});
}

/** PayPal has the payout and has not finished it: pending, unclaimed or held. */
export async function recordPending(tx: Transaction, job: PayoutJob, batchId: string): Promise<void> {
  if (job.state === "submitted") await moveExecution(tx, job, "submitted", "pending_at_paypal", { paypalBatchId: batchId });
  else if (job.batchId === null) await tx.update(executions).set({ paypalBatchId: batchId }).where(eq(executions.id, job.executionId));
}

/**
 * PayPal says the payee has the money: the only point at which Kin records it
 * as paid (AGENTS.md section 5, rule 3). The payout and its fee go to the
 * ledger once, by the PayPal item's ID, and the proposal and bill close.
 */
export async function confirmPayout(tx: Transaction, job: PayoutJob, paid: { readonly itemId: string; readonly batchId: string | null; readonly feeCents: number; readonly at: Date }): Promise<void> {
  if (!(await entryExists(tx, job.circleId, "paypal_event", paid.itemId))) {
    const entry = payoutConfirmed(
      {
        ...header(job, "paypal_event", paid.itemId, paid.at),
        description: job.simulated ? "Caregiver paid (simulated)" : "Caregiver paid through PayPal",
      },
      { payeeId: job.payeeId, cents: job.cents, feeCents: paid.feeCents },
    );
    await writeEntries(tx, [entry], await readAccountIds(tx, job.circleId));
  }
  await moveExecution(tx, job, job.state, "confirmed", { paypalBatchId: paid.batchId ?? job.batchId, paypalItemId: paid.itemId, confirmedAt: paid.at });
  await tx.update(proposals).set({ state: "settled" }).where(and(eq(proposals.id, job.proposalId), eq(proposals.state, "executing")));
  if (job.billId !== null) await tx.update(bills).set({ state: "paid" }).where(and(eq(bills.id, job.billId), eq(bills.state, "proposed")));
  await audit(tx, job, "payout.confirmed", { itemId: paid.itemId, simulated: job.simulated });
}

/**
 * PayPal will not pay it: failed, returned, blocked or reversed. The payee is
 * still owed, so the approval stays in the ledger; the proposal shows the
 * failure and the organizer looks.
 */
export async function failPayout(tx: Transaction, job: PayoutJob, reason: string): Promise<void> {
  await moveExecution(tx, job, job.state, "failed", { lastError: reason });
  await tx.update(proposals).set({ state: "failed" }).where(and(eq(proposals.id, job.proposalId), eq(proposals.state, "executing")));
  await audit(tx, job, "payout.failed", { reason });
}

/** Records, once per reason, why a payout waits. */
export async function recordHeld(tx: Transaction, job: PayoutJob, reason: Exclude<BeginOutcome, "ready">): Promise<void> {
  const [last] = await tx
    .select({ details: auditLog.details })
    .from(auditLog)
    .where(and(eq(auditLog.circleId, job.circleId), eq(auditLog.subjectId, job.executionId), eq(auditLog.action, "payout.held")))
    .orderBy(sql`${auditLog.sequence} desc`)
    .limit(1);
  if ((last?.details as { reason?: string } | undefined)?.reason === reason) return;
  await audit(tx, job, "payout.held", { reason });
}

function header(job: PayoutJob, type: "approval" | "paypal_event", id: string, at: Date = job.now) {
  return {
    id: randomUUID(),
    circleId: job.circleId,
    ...calendarDay(at, job.timezone),
    source: { type, id },
    currency: job.currency,
    simulated: job.simulated,
  };
}

async function entryExists(tx: Transaction, circleId: string, type: "approval" | "paypal_event", id: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.circleId, circleId), eq(ledgerEntries.sourceType, type), eq(ledgerEntries.sourceId, id)));
  return row !== undefined;
}

type ExecutionChanges = Partial<typeof executions.$inferInsert> | Record<string, unknown>;

// The database's transition table refuses any move the diagram does not draw.
async function moveExecution(tx: Transaction, job: PayoutJob, from: ExecutionState, to: ExecutionState, changes: ExecutionChanges): Promise<void> {
  if (from === to) return;
  await tx.update(executions).set({ ...changes, state: to }).where(and(eq(executions.id, job.executionId), eq(executions.state, from)));
}

async function audit(tx: Transaction, job: PayoutJob, action: string, details: Record<string, unknown>): Promise<void> {
  await tx.insert(auditLog).values({ id: randomUUID(), circleId: job.circleId, actor: "service", action, subjectType: "execution", subjectId: job.executionId, details, origin: "worker" });
}
