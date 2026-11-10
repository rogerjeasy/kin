import {
  POOL_CASH,
  PURSE_CASH,
  accountBalance,
  calendarDay,
  cashAvailableForPayouts,
  purseFunded,
  pursePaid,
  purseTopUpCents,
  purseWeekOf,
  releaseHeldPayment,
  sumCents,
  type Ledger,
  type PurseHoldReason,
  type PursePaymentState,
  type PurseRoute,
  type PurseStatus,
  type PurseTerms,
} from "@kin/domain";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { postgresError } from "./caregiver-billing.ts";
import type { Database, Transaction } from "./connection.ts";
import { readAccountIds, readLedger, writeEntries } from "./ledger-store.ts";
import { entryExists, header } from "./payouts.ts";
import { auditLog, circles, proposals, purses, pursePayees, pursePayments } from "./schema/index.ts";
import type { PURSE_PAYEE_KINDS } from "./schema/purse.ts";

/**
 * The parent's Purse in the database (docs/architecture.md, "The parent's
 * Purse"). A person's operations run inside `asPerson`, and the database's own
 * functions check the role and hold the rules again; the worker's run inside
 * `asService` for one circle.
 */

export type PursePayeeKind = (typeof PURSE_PAYEE_KINDS)[number];

export type PurseReason =
  | "refused"
  | "invalid"
  | "duplicate"
  | "not_active"
  | "paused"
  | "over_balance"
  | "not_waiting"
  | "unverified"
  | "book_full"
  | "own_entry"
  | "above_agreement"
  | "rate_limited";

/** A Purse operation was refused. Asking again the same way gives the same answer. */
export class PurseError extends Error {
  readonly retryable = false;
  readonly reason: PurseReason;

  constructor(reason: PurseReason) {
    super(`A Purse operation was refused: ${reason}`);
    this.name = "PurseError";
    this.reason = reason;
  }
}

const REASONS: Readonly<Record<string, PurseReason>> = {
  "42501": "refused",
  "23514": "invalid",
  "22P02": "invalid",
  "23505": "duplicate",
  KU001: "not_active",
  KU002: "paused",
  KU003: "over_balance",
  KU004: "not_waiting",
  KU005: "unverified",
  KU006: "book_full",
  KU007: "own_entry",
  KU008: "above_agreement",
  KU009: "rate_limited",
};

async function operation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = REASONS[postgresError(error)?.code ?? ""];
    if (reason) throw new PurseError(reason);
    throw error;
  }
}

const pgArray = (values: readonly string[]): string => `{${values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;

// ---------------------------------------------------------------------------
// Reading, as the person
// ---------------------------------------------------------------------------

export type PurseRecord = PurseTerms & {
  readonly id: string;
  readonly parentMemberId: string;
  readonly status: PurseStatus;
  readonly setBy: string;
  readonly setAt: Date;
  readonly simulated: boolean;
};

export type PursePayeeRecord = {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  readonly kind: PursePayeeKind;
  readonly aliases: readonly string[];
  readonly paypalReceiver: string;
  readonly addedBy: string;
  readonly verifiedBy: string | null;
  readonly verifiedAt: Date | null;
  readonly simulated: boolean;
};

export type PursePaymentRecord = {
  readonly id: string;
  readonly payeeId: string | null;
  readonly payeeName: string;
  readonly cents: number;
  readonly memo: string | null;
  readonly words: string;
  readonly route: PurseRoute | null;
  readonly markers: readonly string[];
  readonly holdReasons: readonly PurseHoldReason[];
  readonly readBack: string;
  readonly readBackSource: "model" | "template";
  readonly state: PursePaymentState;
  readonly proposedAt: Date;
  readonly expiresAt: Date;
  readonly answeredAt: Date | null;
  readonly answerMethod: "app" | "voice" | null;
  readonly heldAt: Date | null;
  readonly holdEndsAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancelledBy: string | null;
  /** She stopped it herself, telling Kin someone was telling her what to do. */
  readonly pressured: boolean;
  readonly sharedAt: Date | null;
  readonly paidAt: Date | null;
  readonly lastError: string | null;
  readonly simulated: boolean;
  readonly createdAt: Date;
};

/** The circle's Purse, or `null` while the family has not set one up. */
export async function readPurse(tx: Transaction, circleId: string): Promise<PurseRecord | null> {
  const [row] = await tx.select().from(purses).where(eq(purses.circleId, circleId));
  if (!row) return null;
  return {
    id: row.id,
    parentMemberId: row.parentMemberId,
    weeklyCents: row.weeklyCents,
    ceilingCents: row.ceilingCents,
    perPaymentCents: row.perPaymentCents,
    status: row.status as PurseStatus, // Safe: the column's check allows only PURSE_STATUSES.
    setBy: row.setBy,
    setAt: row.setAt,
    simulated: row.simulated,
  };
}

/** Her address book, as the person may see it: everyone not removed, oldest first. */
export async function readPursePayees(tx: Transaction, circleId: string): Promise<PursePayeeRecord[]> {
  const rows = await tx
    .select()
    .from(pursePayees)
    .where(and(eq(pursePayees.circleId, circleId), isNull(pursePayees.removedAt)))
    .orderBy(asc(pursePayees.createdAt), asc(pursePayees.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    relationship: row.relationship,
    kind: row.kind as PursePayeeKind, // Safe: the column's check allows only PURSE_PAYEE_KINDS.
    aliases: row.aliases,
    paypalReceiver: row.paypalReceiver,
    addedBy: row.addedBy,
    verifiedBy: row.verifiedBy,
    verifiedAt: row.verifiedAt,
    simulated: row.simulated,
  }));
}

/**
 * Her payments, newest first, as the person may see them: the parent all of
 * hers, the family only those she shared and those that were held. The rule
 * is row-level security's, so this query cannot read past it.
 */
export async function readPursePayments(tx: Transaction, circleId: string, limit = 50): Promise<PursePaymentRecord[]> {
  const rows = await tx.select().from(pursePayments).where(eq(pursePayments.circleId, circleId)).orderBy(desc(pursePayments.createdAt), desc(pursePayments.id)).limit(limit);
  return rows.map(paymentRecord);
}

/** One of her payments, or `null` when the person may not see it. */
export async function readPursePayment(tx: Transaction, circleId: string, paymentId: string): Promise<PursePaymentRecord | null> {
  const [row] = await tx.select().from(pursePayments).where(and(eq(pursePayments.circleId, circleId), eq(pursePayments.id, paymentId)));
  return row ? paymentRecord(row) : null;
}

function paymentRecord(row: typeof pursePayments.$inferSelect): PursePaymentRecord {
  return {
    id: row.id,
    payeeId: row.payeeId,
    payeeName: row.payeeName,
    cents: row.cents,
    memo: row.memo,
    words: row.words,
    route: row.route as PurseRoute | null, // Safe: the column's check allows only PURSE_ROUTES.
    markers: row.markers,
    holdReasons: row.holdReasons as PurseHoldReason[], // Safe: the column's check allows only PURSE_HOLD_REASONS.
    readBack: row.readBack,
    readBackSource: row.readBackSource === "model" ? "model" : "template",
    state: row.state as PursePaymentState, // Safe: the column's check allows only PURSE_PAYMENT_STATES.
    proposedAt: row.proposedAt,
    expiresAt: row.expiresAt,
    answeredAt: row.answeredAt,
    answerMethod: row.answerMethod === "voice" ? "voice" : row.answerMethod === "app" ? "app" : null,
    heldAt: row.heldAt,
    holdEndsAt: row.holdEndsAt,
    cancelledAt: row.cancelledAt,
    cancelledBy: row.cancelledBy,
    pressured: row.pressured,
    sharedAt: row.sharedAt,
    paidAt: row.paidAt,
    lastError: row.lastError,
    simulated: row.simulated,
    createdAt: row.createdAt,
  };
}

/**
 * Whether the Purse may be spent now, by the database's one rule: the Purse is
 * active, the circle is not paused, and nothing else holds outgoing money.
 * Every path that spends or funds the Purse asks this.
 */
export async function readPurseSpendingAllowed(tx: Transaction, circleId: string): Promise<boolean> {
  const result = await tx.execute<{ allowed: boolean }>(sql`select kin_private.purse_spending_allowed(${circleId}::uuid) as allowed`);
  return result.rows[0]?.allowed === true;
}

// ---------------------------------------------------------------------------
// Writing, as the person
// ---------------------------------------------------------------------------

/** The organizer sets the Purse up or changes its terms. Returns the Purse's ID. */
export function setPurse(tx: Transaction, input: PurseTerms & { readonly circleId: string }): Promise<string> {
  return operation(async () => {
    const result = await tx.execute<{ id: string }>(sql`select kin_private.set_purse(${input.circleId}::uuid, ${input.weeklyCents}::bigint, ${input.ceilingCents}::bigint, ${input.perPaymentCents}::bigint) as id`);
    const id = result.rows[0]?.id;
    if (typeof id !== "string") throw new Error("Setting up the Purse returned nothing");
    return id;
  });
}

export function setPurseStatus(tx: Transaction, circleId: string, status: PurseStatus): Promise<void> {
  return operation(async () => {
    await tx.execute(sql`select kin_private.set_purse_status(${circleId}::uuid, ${status})`);
  });
}

export type AddPursePayeeInput = {
  readonly circleId: string;
  readonly name: string;
  readonly relationship: string;
  readonly kind: PursePayeeKind;
  readonly paypalReceiver: string;
  readonly aliases?: readonly string[];
};

export function addPursePayee(tx: Transaction, input: AddPursePayeeInput): Promise<string> {
  return operation(async () => {
    const result = await tx.execute<{ id: string }>(
      sql`select kin_private.add_purse_payee(${input.circleId}::uuid, ${input.name}, ${input.relationship}, ${input.kind}, ${input.paypalReceiver}, ${pgArray(input.aliases ?? [])}::text[]) as id`,
    );
    const id = result.rows[0]?.id;
    if (typeof id !== "string") throw new Error("Adding to the address book returned nothing");
    return id;
  });
}

export function verifyPursePayee(tx: Transaction, circleId: string, payeeId: string): Promise<void> {
  return operation(async () => {
    await tx.execute(sql`select kin_private.verify_purse_payee(${circleId}::uuid, ${payeeId}::uuid)`);
  });
}

export function removePursePayee(tx: Transaction, circleId: string, payeeId: string): Promise<void> {
  return operation(async () => {
    await tx.execute(sql`select kin_private.remove_purse_payee(${circleId}::uuid, ${payeeId}::uuid)`);
  });
}

export type ProposePursePaymentInput = {
  readonly circleId: string;
  /** The verified address-book entry, or `null` for someone not in it. */
  readonly payeeId: string | null;
  readonly payeeName: string;
  readonly cents: number;
  readonly memo: string | null;
  readonly words: string;
  readonly route: PurseRoute | null;
  readonly markers: readonly string[];
  readonly holdReasons: readonly PurseHoldReason[];
  readonly readBack: string;
  readonly readBackSource: "model" | "template";
};

/** She asks Kin to pay someone. Nothing is approved until she answers. */
export function proposePursePayment(tx: Transaction, input: ProposePursePaymentInput): Promise<{ readonly id: string; readonly expiresAt: Date }> {
  return operation(async () => {
    const result = await tx.execute<{ proposed: { id?: unknown; expiresAt?: unknown } }>(
      sql`select kin_private.propose_purse_payment(${input.circleId}::uuid, ${input.payeeId}::uuid, ${input.payeeName}, ${input.cents}::bigint, ${input.memo}, ${input.words}, ${input.route},
        ${pgArray(input.markers)}::text[], ${pgArray(input.holdReasons)}::text[], ${input.readBack}, ${input.readBackSource}) as proposed`,
    );
    const proposed = result.rows[0]?.proposed;
    if (typeof proposed?.id !== "string" || typeof proposed.expiresAt !== "string") throw new Error("Proposing a Purse payment returned nothing");
    return { id: proposed.id, expiresAt: new Date(proposed.expiresAt) };
  });
}

/** Her answer: yes, no, or (to a payment Kin would hold) that someone is telling her what to do. */
export type PurseAnswer = "yes" | "no" | "pressured";

/**
 * Her answer. Her yes is the payment's recorded approval: it is held, or
 * approved for the worker to pay. "Pressured" holds it, so the family sees it,
 * and stops it at once in her name.
 */
export function answerPursePayment(
  tx: Transaction,
  input: { readonly circleId: string; readonly paymentId: string; readonly answer: PurseAnswer; readonly method: "app" | "voice"; readonly evidence: string },
): Promise<"declined" | "held" | "approved" | "stopped"> {
  return operation(async () => {
    const result = await tx.execute<{ outcome: string }>(
      sql`select kin_private.answer_purse_payment(${input.circleId}::uuid, ${input.paymentId}::uuid, ${input.answer}, ${input.method}, ${input.evidence}) as outcome`,
    );
    const outcome = result.rows[0]?.outcome;
    if (outcome !== "declined" && outcome !== "held" && outcome !== "approved" && outcome !== "stopped") throw new Error("Answering a Purse payment returned nothing");
    return outcome;
  });
}

/** Stops a held payment: her, or a member who answers for the family. `pressured` records that she said someone was telling her what to do. */
export function cancelPursePayment(tx: Transaction, input: { readonly circleId: string; readonly paymentId: string; readonly pressured: boolean }): Promise<void> {
  return operation(async () => {
    await tx.execute(sql`select kin_private.cancel_purse_payment(${input.circleId}::uuid, ${input.paymentId}::uuid, ${input.pressured})`);
  });
}

/** Her consent for the family to see one payment, given or taken back. */
export function sharePursePayment(tx: Transaction, input: { readonly circleId: string; readonly paymentId: string; readonly share: boolean }): Promise<void> {
  return operation(async () => {
    await tx.execute(sql`select kin_private.share_purse_payment(${input.circleId}::uuid, ${input.paymentId}::uuid, ${input.share})`);
  });
}

// ---------------------------------------------------------------------------
// The worker, as Kin's service for one circle
// ---------------------------------------------------------------------------

/** The circles with Purse work: a Purse to fund, or a payment to move or reconcile. As Kin's service only. */
export async function purseCircles(db: Database): Promise<string[]> {
  const result = await db.execute<{ purse_circles: string }>(sql`select * from kin_private.purse_circles()`);
  return result.rows.map((row) => row.purse_circles);
}

/** What the worker needs of one circle, read inside its service scope. */
export type PurseContext = {
  readonly circleId: string;
  readonly currency: string;
  readonly timezone: string;
  /** A demo circle's Purse is simulated: nothing reaches PayPal, and the ledger says so. */
  readonly simulated: boolean;
  /** The circle's clock: the demo's, or the real time. */
  readonly now: Date;
  readonly purse: PurseRecord;
  readonly spendingAllowed: boolean;
};

export async function readPurseContext(tx: Transaction, circleId: string, realNow: Date): Promise<PurseContext | null> {
  const purse = await readPurse(tx, circleId);
  const [circle] = await tx.select({ currency: circles.currency, timezone: circles.timezone, demo: circles.demo, clockAt: circles.clockAt, status: circles.status }).from(circles).where(eq(circles.id, circleId));
  if (purse === null || !circle || circle.status !== "active") return null;
  return { circleId, currency: circle.currency, timezone: circle.timezone, simulated: circle.demo, now: circle.clockAt ?? realNow, purse, spendingAllowed: await readPurseSpendingAllowed(tx, circleId) };
}

/** Payouts approved by the family but not yet in the ledger draw on the pool's cash too: the float leaves them room. */
async function approvedOutgoingCents(tx: Transaction, circleId: string): Promise<number> {
  const [row] = await tx
    .select({ cents: sql<string>`coalesce(sum(${proposals.cents}), 0)` })
    .from(proposals)
    .where(and(eq(proposals.circleId, circleId), inArray(proposals.state, ["approved", "executing"])));
  return Number(row?.cents ?? 0);
}

async function reservedCents(tx: Transaction, circleId: string, states: readonly PursePaymentState[], except: string | null = null): Promise<number> {
  const rows = await tx.select({ id: pursePayments.id, cents: pursePayments.cents }).from(pursePayments).where(and(eq(pursePayments.circleId, circleId), inArray(pursePayments.state, [...states])));
  return sumCents(rows.filter((row) => row.id !== except).map((row) => row.cents));
}

const fundingSource = (purseId: string, week: string): string => `purse-week:${purseId}:${week}`;

/**
 * Moves this week's float into the Purse, once a week, up to its ceiling, from
 * money that has arrived and is promised to nobody. Returns the cents moved.
 */
export async function fundPurse(tx: Transaction, context: PurseContext): Promise<number> {
  const { purse } = context;
  const week = purseWeekOf(calendarDay(context.now, context.timezone).occurredOn);
  const source = fundingSource(purse.id, week);
  const fundedThisWeek = await entryExists(tx, context.circleId, "approval", source);
  const ledger = await readLedger(tx, { id: context.circleId, currency: context.currency });
  const poolAvailableCents = Math.max(0, cashAvailableForPayouts(ledger) - (await approvedOutgoingCents(tx, context.circleId)));
  const cents = purseTopUpCents({ terms: purse, status: purse.status, balanceCents: accountBalance(ledger, PURSE_CASH), poolAvailableCents, fundedThisWeek, spendingAllowed: context.spendingAllowed });
  if (cents === 0) return 0;
  const entry = purseFunded({ ...header(context, "approval", source), description: context.simulated ? "Weekly float to the parent's Purse (simulated)" : "Weekly float to the parent's Purse" }, { cents });
  await writeEntries(tx, [entry], await readAccountIds(tx, context.circleId));
  await audit(tx, context.circleId, "purse.funded", purse.id, "purse", { cents, week });
  return cents;
}

/** Ends the read-backs she never answered. */
export async function expireUnanswered(tx: Transaction, context: PurseContext): Promise<number> {
  const result = await tx
    .update(pursePayments)
    .set({ state: "expired" })
    .where(and(eq(pursePayments.circleId, context.circleId), eq(pursePayments.state, "proposed"), sql`${pursePayments.expiresAt} < ${context.now}`))
    .returning({ id: pursePayments.id });
  return result.length;
}

/** What the Purse can spend now by the ledger, less what is spoken for. */
async function purseAvailable(tx: Transaction, context: PurseContext, ledger: Ledger, except: string): Promise<number> {
  return accountBalance(ledger, PURSE_CASH) - (await reservedCents(tx, context.circleId, ["approved", "executing", "unknown"], except));
}

/**
 * Lets the held payments whose cooling-off has ended go, or lapse. The rule is
 * the money core's (`releaseHeldPayment`); the database refuses an approval
 * before the hold ends, to an unverified payee, or after a cancellation.
 */
export async function releaseHolds(tx: Transaction, context: PurseContext): Promise<{ readonly approved: number; readonly lapsed: number }> {
  const held = await tx
    .select({ id: pursePayments.id, cents: pursePayments.cents, holdEndsAt: pursePayments.holdEndsAt, payeeId: pursePayments.payeeId, receiver: pursePayees.paypalReceiver, verifiedAt: pursePayees.verifiedAt, removedAt: pursePayees.removedAt })
    .from(pursePayments)
    .leftJoin(pursePayees, and(eq(pursePayees.circleId, pursePayments.circleId), eq(pursePayees.id, pursePayments.payeeId)))
    .where(and(eq(pursePayments.circleId, context.circleId), eq(pursePayments.state, "held"), sql`${pursePayments.holdEndsAt} <= ${context.now}`))
    .orderBy(asc(pursePayments.createdAt))
    .for("update", { of: pursePayments });
  const ledger = await readLedger(tx, { id: context.circleId, currency: context.currency });
  let approved = 0;
  let lapsed = 0;
  for (const payment of held) {
    if (payment.holdEndsAt === null) continue;
    const verified = payment.payeeId !== null && payment.verifiedAt !== null && payment.removedAt === null && payment.receiver !== null;
    const available = await purseAvailable(tx, context, ledger, payment.id);
    const next = releaseHeldPayment({ cents: payment.cents, holdEndsAt: payment.holdEndsAt, payeeVerified: verified }, { availableCents: Math.max(0, available), spendingAllowed: context.spendingAllowed }, context.now);
    if (next === "wait") continue;
    if (next === "pay" && payment.receiver !== null) {
      await tx.update(pursePayments).set({ state: "approved", receiver: payment.receiver }).where(and(eq(pursePayments.id, payment.id), eq(pursePayments.state, "held")));
      await audit(tx, context.circleId, "purse.hold_released", payment.id, "purse_payment", {});
      approved += 1;
    } else {
      await tx.update(pursePayments).set({ state: "expired" }).where(and(eq(pursePayments.id, payment.id), eq(pursePayments.state, "held")));
      await audit(tx, context.circleId, "purse.hold_lapsed", payment.id, "purse_payment", { verified });
      lapsed += 1;
    }
  }
  return { approved, lapsed };
}

/** One payment the worker carries further. */
export type PurseJob = {
  readonly paymentId: string;
  readonly cents: number;
  readonly state: PursePaymentState;
  readonly receiver: string | null;
  readonly idempotencyKey: string;
  readonly batchId: string | null;
  readonly payeeVerified: boolean;
};

/** The payments the worker must carry: approved ones to send, and sent ones whose outcome PayPal has not given. */
export async function readPurseJobs(tx: Transaction, circleId: string): Promise<PurseJob[]> {
  const rows = await tx
    .select({
      paymentId: pursePayments.id,
      cents: pursePayments.cents,
      state: pursePayments.state,
      receiver: pursePayments.receiver,
      idempotencyKey: pursePayments.idempotencyKey,
      batchId: pursePayments.paypalBatchId,
      verifiedAt: pursePayees.verifiedAt,
      removedAt: pursePayees.removedAt,
    })
    .from(pursePayments)
    .leftJoin(pursePayees, and(eq(pursePayees.circleId, pursePayments.circleId), eq(pursePayees.id, pursePayments.payeeId)))
    .where(and(eq(pursePayments.circleId, circleId), inArray(pursePayments.state, ["approved", "executing", "unknown"])))
    .orderBy(asc(pursePayments.createdAt));
  return rows.map((row) => ({
    paymentId: row.paymentId,
    cents: row.cents,
    state: row.state as PursePaymentState, // Safe: the column's check allows only PURSE_PAYMENT_STATES.
    receiver: row.receiver,
    idempotencyKey: row.idempotencyKey,
    batchId: row.batchId,
    payeeVerified: row.verifiedAt !== null && row.removedAt === null,
  }));
}

/** Locks one payment for this transaction and reads it again. */
export async function lockPurseJob(tx: Transaction, circleId: string, paymentId: string): Promise<PurseJob | null> {
  await tx.select({ id: pursePayments.id }).from(pursePayments).where(and(eq(pursePayments.circleId, circleId), eq(pursePayments.id, paymentId))).for("update");
  return (await readPurseJobs(tx, circleId)).find((job) => job.paymentId === paymentId) ?? null;
}

export type PurseBegin = "ready" | "paused" | "waiting_for_funds" | "payee_removed";

/**
 * Readies an approved payment to be sent: while the Purse may be spent, the
 * payee is still in her book, the Purse holds the amount and the pool can pay
 * PayPal's fee from money that has arrived (AGENTS.md section 5, rule 8). A
 * payee removed since her yes fails it: the money stays in her Purse.
 */
export async function beginPursePayment(tx: Transaction, context: PurseContext, job: PurseJob, feeReserveCents: number): Promise<PurseBegin> {
  if (!context.spendingAllowed) return "paused";
  if (!job.payeeVerified) {
    await tx.update(pursePayments).set({ state: "executing" }).where(and(eq(pursePayments.id, job.paymentId), eq(pursePayments.state, "approved")));
    await failPursePayment(tx, context, { ...job, state: "executing" }, "payee_removed");
    return "payee_removed";
  }
  const ledger = await readLedger(tx, { id: context.circleId, currency: context.currency });
  const inPurse = accountBalance(ledger, PURSE_CASH) - (await reservedCents(tx, context.circleId, ["executing", "unknown"], job.paymentId));
  const forFee = Math.min(accountBalance(ledger, POOL_CASH), cashAvailableForPayouts(ledger));
  if (inPurse < job.cents || forFee < feeReserveCents) return "waiting_for_funds";
  await tx.update(pursePayments).set({ state: "executing" }).where(and(eq(pursePayments.id, job.paymentId), eq(pursePayments.state, "approved")));
  return "ready";
}

/** PayPal was asked to pay. The batch ID is `null` when its answer never came back. */
export async function recordPurseSubmitted(tx: Transaction, job: PurseJob, batchId: string | null, at: Date): Promise<void> {
  await tx.update(pursePayments).set({ paypalBatchId: batchId, submittedAt: at, attempts: sql`${pursePayments.attempts} + 1` }).where(eq(pursePayments.id, job.paymentId));
}

/** Whether PayPal paid is not known. Kin asks again with the same key; it never assumes either way. */
export async function recordPurseUnknown(tx: Transaction, context: PurseContext, job: PurseJob): Promise<void> {
  if (job.state !== "executing") return;
  await tx.update(pursePayments).set({ state: "unknown" }).where(and(eq(pursePayments.id, job.paymentId), eq(pursePayments.state, "executing")));
  await audit(tx, context.circleId, "purse.unknown", job.paymentId, "purse_payment", {});
}

/**
 * PayPal says the payee has the money, or a demo circle's payment is
 * simulated: the only point at which Kin records it as paid. The entry is
 * written once, by the PayPal item's ID, and names no payee.
 */
export async function confirmPursePayment(tx: Transaction, context: PurseContext, job: PurseJob, paid: { readonly itemId: string; readonly batchId: string | null; readonly feeCents: number; readonly at: Date }): Promise<void> {
  if (!(await entryExists(tx, context.circleId, "paypal_event", paid.itemId))) {
    const entry = pursePaid(
      { ...header(context, "paypal_event", paid.itemId, paid.at), description: context.simulated ? "Paid from the parent's Purse (simulated)" : "Paid from the parent's Purse through PayPal" },
      { cents: job.cents, feeCents: paid.feeCents },
    );
    await writeEntries(tx, [entry], await readAccountIds(tx, context.circleId));
  }
  await tx
    .update(pursePayments)
    .set({ state: "paid", paidAt: paid.at, paypalItemId: paid.itemId, paypalBatchId: paid.batchId ?? job.batchId, feeCents: paid.feeCents })
    .where(and(eq(pursePayments.id, job.paymentId), inArray(pursePayments.state, ["executing", "unknown"])));
  await audit(tx, context.circleId, "purse.paid", job.paymentId, "purse_payment", { simulated: context.simulated });
}

/** PayPal will not pay it. Nothing left the Purse, so the money is hers to spend again. */
export async function failPursePayment(tx: Transaction, context: PurseContext, job: PurseJob, reason: string): Promise<void> {
  await tx
    .update(pursePayments)
    .set({ state: "failed", lastError: reason })
    .where(and(eq(pursePayments.id, job.paymentId), inArray(pursePayments.state, ["executing", "unknown"])));
  await audit(tx, context.circleId, "purse.failed", job.paymentId, "purse_payment", { reason });
}

/** The circle's paid, real Purse payments that PayPal's Transaction Search has not yet shown. */
export async function readUnreconciledPurse(tx: Transaction, circleId: string): Promise<{ readonly paymentId: string; readonly itemId: string; readonly cents: number; readonly paidAt: Date }[]> {
  const rows = await tx
    .select({ paymentId: pursePayments.id, itemId: pursePayments.paypalItemId, cents: pursePayments.cents, paidAt: pursePayments.paidAt })
    .from(pursePayments)
    .where(and(eq(pursePayments.circleId, circleId), eq(pursePayments.state, "paid"), eq(pursePayments.simulated, false), isNull(pursePayments.reconciledAt)));
  return rows.flatMap((row) => (row.itemId !== null && row.paidAt !== null ? [{ paymentId: row.paymentId, itemId: row.itemId, cents: row.cents, paidAt: row.paidAt }] : []));
}

/** PayPal's own record shows the payment left the pool, for the amount Kin recorded. */
export async function recordPurseReconciled(tx: Transaction, circleId: string, paymentId: string, at: Date): Promise<void> {
  await tx.update(pursePayments).set({ reconciledAt: at }).where(and(eq(pursePayments.circleId, circleId), eq(pursePayments.id, paymentId), isNull(pursePayments.reconciledAt)));
  await audit(tx, circleId, "purse.reconciled", paymentId, "purse_payment", {});
}

/** PayPal's record disagrees with Kin's: a serious fault, recorded for a person and never corrected by itself. */
export async function recordPurseMismatch(tx: Transaction, circleId: string, paymentId: string, detail: string): Promise<void> {
  await audit(tx, circleId, "purse.reconcile_mismatch", paymentId, "purse_payment", { detail });
}

async function audit(tx: Transaction, circleId: string, action: string, subjectId: string, subjectType: "purse" | "purse_payment", details: Record<string, unknown>): Promise<void> {
  await tx.insert(auditLog).values({ id: randomUUID(), circleId, actor: "service", action, subjectType, subjectId, details, origin: "worker" });
}
