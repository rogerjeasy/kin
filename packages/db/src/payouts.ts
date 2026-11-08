import { SHIFT_PURPOSE, billApproved, calendarDay, canPayOut, isPaused, payoutConfirmed, settlementPaidOut, type ExecutionState } from "@kin/domain";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Database, Transaction } from "./connection.ts";
import { readAccountIds, readLedger, writeEntries } from "./ledger-store.ts";
import { auditLog, bills, circles, executions, ledgerEntries, outbox, payees, proposals, settlements } from "./schema/index.ts";
import { markShiftPaid } from "./shifts.ts";
import type { PayoutWallet } from "./values.ts";

/** The outbox topic that asks the worker to pay an approved caregiver or settlement payout. */
export const PAYOUT_TOPIC = "payout.execute";

/** The proposal kinds the worker pays out: a caregiver's bill, or a member's share of a settlement. */
export type PayoutKind = "caregiver_payout" | "member_payout";

/** One approved payout, as the worker needs it. Read inside the circle's service scope. */
export type PayoutJob = {
  readonly executionId: string;
  readonly circleId: string;
  readonly proposalId: string;
  readonly kind: PayoutKind;
  readonly billId: string | null;
  /** The settlement a member payout belongs to. */
  readonly settlementId: string | null;
  /** Who is paid, for a caregiver's bill. */
  readonly payeeId: string | null;
  /** Who is paid, for a settlement. */
  readonly memberId: string | null;
  readonly category: string;
  /** What the payout is for, as the proposal records it: a caregiver's bill, a settlement, a care shift. */
  readonly purpose: string;
  /** The PayPal email the money goes to, fixed on the execution, or `null` while none is known. */
  readonly receiver: string | null;
  /** Which wallet the receiver names: PayPal, or Venmo through PayPal Payouts. Fixed on the execution with the receiver. */
  readonly wallet: PayoutWallet;
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
      settlementId: proposals.settlementId,
      payeeId: proposals.payeeId,
      memberId: proposals.memberId,
      kind: proposals.kind,
      purpose: proposals.purpose,
      category: payees.category,
      receiver: executions.receiver,
      wallet: executions.wallet,
      payeeReceiver: payees.paypalReceiver,
      currency: circles.currency,
      demo: circles.demo,
      clockAt: circles.clockAt,
      timezone: circles.timezone,
      pausedUntil: circles.pausedUntil,
    })
    .from(executions)
    .innerJoin(proposals, and(eq(proposals.circleId, executions.circleId), eq(proposals.id, executions.proposalId)))
    .leftJoin(payees, and(eq(payees.circleId, proposals.circleId), eq(payees.id, proposals.payeeId)))
    .innerJoin(circles, eq(circles.id, executions.circleId))
    .where(eq(executions.id, executionId))
    .for("update", { of: executions });
  if (!row) return null;
  const { kind } = row;
  if (kind !== "caregiver_payout" && kind !== "member_payout") return null;
  if (kind === "caregiver_payout" ? row.payeeId === null || row.category === null : row.memberId === null) return null;
  // A member's address is the one they gave for settlements, a payee row of its own category.
  const memberReceiver = kind === "member_payout" && row.memberId !== null ? await settlementReceiver(tx, row.circleId, row.memberId) : null;
  return {
    executionId: row.executionId,
    circleId: row.circleId,
    proposalId: row.proposalId,
    kind,
    billId: row.billId,
    settlementId: row.settlementId,
    payeeId: row.payeeId,
    memberId: row.memberId,
    category: row.category ?? "settlement",
    purpose: row.purpose,
    receiver: row.receiver,
    wallet: row.wallet,
    payeeReceiver: kind === "member_payout" ? memberReceiver : row.payeeReceiver,
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

async function settlementReceiver(tx: Transaction, circleId: string, memberId: string): Promise<string | null> {
  const [payee] = await tx.select({ receiver: payees.paypalReceiver }).from(payees).where(and(eq(payees.circleId, circleId), eq(payees.memberId, memberId), eq(payees.category, "settlement")));
  return payee?.receiver ?? null;
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
  // A settlement payout is owed from the member's own balance: there is no bill to approve into the ledger first.
  const settlement = job.kind === "member_payout";
  const owed = !settlement && (await entryExists(tx, job.circleId, "approval", job.proposalId));
  const ledger = await readLedger(tx, { id: job.circleId, currency: job.currency });
  const reservedCents = settlement ? await inFlightSettlementCents(tx, job) : 0;
  if (!canPayOut(ledger, { cents: job.cents, feeCents: feeReserveCents, alreadyOwed: owed, reservedCents })) return "waiting_for_funds";
  if (!settlement && job.payeeId !== null && !owed) {
    const entry = billApproved(
      { ...header(job, `approval`, job.proposalId), description: job.purpose === SHIFT_PURPOSE ? "Care shift approved by the family" : "Caregiver bill approved by the family" },
      { payeeId: job.payeeId, category: job.category, cents: job.cents },
    );
    await writeEntries(tx, [entry], await readAccountIds(tx, job.circleId));
  }
  await tx.update(proposals).set({ state: "executing" }).where(and(eq(proposals.id, job.proposalId), eq(proposals.state, "approved")));
  return "ready";
}

// Settlement payouts already readied but not yet confirmed draw on the same cash, and the ledger
// shows nothing of them until PayPal says so. They are counted, so two cannot spend it twice.
async function inFlightSettlementCents(tx: Transaction, job: PayoutJob): Promise<number> {
  const [row] = await tx
    .select({ cents: sql<string>`coalesce(sum(${proposals.cents}), 0)` })
    .from(proposals)
    .where(and(eq(proposals.circleId, job.circleId), eq(proposals.kind, "member_payout"), eq(proposals.state, "executing"), ne(proposals.id, job.proposalId)));
  return Number(row?.cents ?? 0);
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
    await writeEntries(tx, [paidEntry(job, paid)], await readAccountIds(tx, job.circleId));
  }
  await moveExecution(tx, job, job.state, "confirmed", { paypalBatchId: paid.batchId ?? job.batchId, paypalItemId: paid.itemId, confirmedAt: paid.at });
  await tx.update(proposals).set({ state: "settled" }).where(and(eq(proposals.id, job.proposalId), eq(proposals.state, "executing")));
  if (job.billId !== null) await tx.update(bills).set({ state: "paid" }).where(and(eq(bills.id, job.billId), eq(bills.state, "proposed")));
  if (job.settlementId !== null) await closeSettlementIfDone(tx, job.circleId, job.settlementId);
  // A care shift has no bill: its payout is what moves it from priced to paid.
  if (job.kind === "caregiver_payout" && job.purpose === SHIFT_PURPOSE) await markShiftPaid(tx, { circleId: job.circleId, proposalId: job.proposalId });
  await audit(tx, job, "payout.confirmed", { itemId: paid.itemId, simulated: job.simulated });
}

// The money core words the entry: a caregiver's bill is paid from what the pool owes the payee, a
// settlement from what the pool owes the member. Both say whether the money was real.
function paidEntry(job: PayoutJob, paid: { readonly itemId: string; readonly feeCents: number; readonly at: Date }) {
  const entryHeader = header(job, "paypal_event", paid.itemId, paid.at);
  if (job.kind === "member_payout" && job.memberId !== null) {
    return settlementPaidOut(
      { ...entryHeader, description: job.simulated ? "Settlement paid (simulated)" : "Settlement paid through PayPal" },
      { memberId: job.memberId, cents: job.cents, feeCents: paid.feeCents },
    );
  }
  if (job.payeeId === null) throw new Error(`Payout ${job.executionId} has no one to pay`);
  return payoutConfirmed(
    { ...entryHeader, description: job.simulated ? "Caregiver paid (simulated)" : "Caregiver paid through PayPal" },
    { payeeId: job.payeeId, cents: job.cents, feeCents: paid.feeCents },
  );
}

// A settlement is done once none of its payouts is still waiting or under way.
async function closeSettlementIfDone(tx: Transaction, circleId: string, settlementId: string): Promise<void> {
  const [open] = await tx
    .select({ count: sql<string>`count(*)` })
    .from(proposals)
    .where(and(eq(proposals.circleId, circleId), eq(proposals.settlementId, settlementId), inArray(proposals.state, ["proposed", "pending_approval", "approved", "executing", "failed"])));
  if (Number(open?.count ?? 0) === 0) {
    await tx.update(settlements).set({ state: "settled" }).where(and(eq(settlements.circleId, circleId), eq(settlements.id, settlementId), eq(settlements.state, "approved")));
  }
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

/** What an entry's header needs of the job it is written for. */
export type EntryContext = Pick<PayoutJob, "circleId" | "currency" | "timezone" | "simulated" | "now">;

export function header(job: EntryContext, type: "approval" | "paypal_event", id: string, at: Date = job.now) {
  return {
    id: randomUUID(),
    circleId: job.circleId,
    ...calendarDay(at, job.timezone),
    source: { type, id },
    currency: job.currency,
    simulated: job.simulated,
  };
}

export async function entryExists(tx: Transaction, circleId: string, type: "approval" | "paypal_event", id: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.circleId, circleId), eq(ledgerEntries.sourceType, type), eq(ledgerEntries.sourceId, id)));
  return row !== undefined;
}

type ExecutionChanges = Partial<typeof executions.$inferInsert> | Record<string, unknown>;

// The database's transition table refuses any move the diagram does not draw.
export async function moveExecution(tx: Transaction, job: Pick<PayoutJob, "executionId">, from: ExecutionState, to: ExecutionState, changes: ExecutionChanges): Promise<void> {
  if (from === to) return;
  await tx.update(executions).set({ ...changes, state: to }).where(and(eq(executions.id, job.executionId), eq(executions.state, from)));
}

export async function audit(tx: Transaction, job: Pick<PayoutJob, "circleId" | "executionId">, action: string, details: Record<string, unknown>): Promise<void> {
  await tx.insert(auditLog).values({ id: randomUUID(), circleId: job.circleId, actor: "service", action, subjectType: "execution", subjectId: job.executionId, details, origin: "worker" });
}
