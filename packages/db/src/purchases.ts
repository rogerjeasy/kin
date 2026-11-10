import {
  PurchaseError,
  calendarDay,
  canPayOut,
  decideMandate,
  isPaused,
  planPurchase,
  purchaseCaptured,
  type DeliveryState,
  type ExecutionState,
  type MandateRefusal,
  type ParentLevel,
  type PurchaseRule,
} from "@kin/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { readAgreementVersions } from "./agreements.ts";
import { postgresError, requiredId } from "./caregiver-billing.ts";
import type { PurchaseRecord, PurchaseRuleRecord } from "./circle-snapshot.ts";
import type { Transaction } from "./connection.ts";
import { readMandateCandidates } from "./mandates.ts";
import { readAccountIds, readLedger, writeEntries } from "./ledger-store.ts";
import { audit, entryExists, header, moveExecution } from "./payouts.ts";
import { laterOf, outgoingMoneyHeldByPresence } from "./presence.ts";
import { auditLog, circles, executions, mandateUses, mandates, members, outbox, payees, proposals, purchaseRules, purchases } from "./schema/index.ts";
import { readDiscretionaryPause } from "./wishes.ts";

/** The outbox topics: buy an approved refill, and follow an order to the door. */
export const PURCHASE_TOPIC = "purchase.execute";
export const DELIVERY_TOPIC = "purchase.deliver";

export type RefillReason = "refused" | "invalid" | "demo_only" | "above_limit" | "over_budget" | "seller_not_approved" | "above_ceiling" | "paused" | "no_agreement" | "wish_hold";

/** A refill cannot be proposed. Asking again cannot help until what blocks it changes. */
export class RefillError extends Error {
  readonly retryable = false;
  readonly reason: RefillReason;

  constructor(reason: RefillReason) {
    super(`A refill cannot be proposed: ${reason}`);
    this.name = "RefillError";
    this.reason = reason;
  }
}

const COUNTED = ["pending_approval", "approved", "executing", "settled"] as const;

/** What a rule's purchases already cost this calendar month, counting those still waiting for a yes. */
async function committedThisMonth(tx: Transaction, circleId: string, ruleId: string, now: Date, timezone: string): Promise<number> {
  const month = calendarDay(now, timezone).period;
  const rows = await tx
    .select({ cents: purchases.cents, raisedAt: proposals.raisedAt })
    .from(purchases)
    .innerJoin(proposals, and(eq(proposals.circleId, purchases.circleId), eq(proposals.id, purchases.proposalId)))
    .where(and(eq(purchases.circleId, circleId), eq(purchases.ruleId, ruleId), inArray(proposals.state, COUNTED)));
  return rows.filter((row) => calendarDay(row.raisedAt, timezone).period === month).reduce((sum, row) => sum + row.cents, 0);
}

/** How a refill stood against the parent's standing permission: none, inside it, or outside it so she is asked. */
export type RefillMandate =
  | { readonly outcome: "none" }
  | { readonly outcome: "covered"; readonly mandateId: string }
  | { readonly outcome: "ask_parent"; readonly reason: MandateRefusal };

export type RefillProposed = { readonly id: string; readonly mandate: RefillMandate };

/**
 * Raises a refill. Kin proposes it from a rule the family set; plain code
 * checks that it fits the rule and plans who must say yes, and the database
 * operation refuses a plan that does not match the agreement. A refill that
 * fits a live mandate (the parent's standing permission, also checked by
 * plain code) is approved at once with the mandate recorded as the approver;
 * one that does not fit it falls back to asking, and says why. Nothing is
 * bought here: only the approval queues the purchase.
 * Run as the person, inside `asPerson`, or inside `asDelegate` with
 * `standingPermission: false` for a refill a member's own assistant raised:
 * that one never rides the standing permission and always waits for a
 * person's yes in Kin, which the database enforces again.
 */
export async function proposeRefill(
  tx: Transaction,
  input: { readonly circleId: string; readonly ruleId: string; readonly now: Date; /** Whether the parent's standing permission may approve it. */ readonly standingPermission?: boolean },
): Promise<RefillProposed> {
  const { circleId, ruleId, now } = input;
  const [row] = await tx
    .select({ rule: purchaseRules, status: payees.status, pausedUntil: circles.pausedUntil, timezone: circles.timezone })
    .from(purchaseRules)
    .innerJoin(payees, and(eq(payees.circleId, purchaseRules.circleId), eq(payees.id, purchaseRules.payeeId)))
    .innerJoin(circles, eq(circles.id, purchaseRules.circleId))
    .where(and(eq(purchaseRules.circleId, circleId), eq(purchaseRules.id, ruleId)));
  if (!row) throw new RefillError("refused");
  // While the parent's wishes pause discretionary spending, nothing is raised to buy.
  if ((await readDiscretionaryPause(tx, circleId)).paused) throw new RefillError("wish_hold");
  const { versions } = await readAgreementVersions(tx, circleId, calendarDay(now, row.timezone).occurredOn);
  const agreement = versions.find((version) => version.status === "in_force");
  // No agreement can mean none exists or that this person may not read it: the database tells the two apart.
  if (!agreement) {
    await refillOperation(() => callPropose(tx, circleId, ruleId, null));
    throw new RefillError("no_agreement");
  }
  const rule: PurchaseRule = {
    ruleId: row.rule.id,
    seller: { payeeId: row.rule.payeeId, approved: row.status === "approved" },
    category: row.rule.category,
    priceCents: row.rule.priceCents,
    limitCents: row.rule.limitCents,
    monthlyBudgetCents: row.rule.monthlyBudgetCents,
  };
  try {
    const { plan } = planPurchase({
      rule,
      committedCents: await committedThisMonth(tx, circleId, ruleId, now, row.timezone),
      payee: { status: row.status, member: null, autoPay: null },
      agreement: { version: agreement.version, approvals: agreement.approvals },
      parentLevel: await parentLevel(tx, circleId),
      pausedUntil: row.pausedUntil,
      now,
    });
    if (plan.outcome === "paused") throw new RefillError("paused");
    if (plan.outcome === "refused") throw new RefillError("above_ceiling");
    const decision = decideMandate(
      await readMandateCandidates(tx, { circleId, ruleId, now, timezone: row.timezone, pausedUntil: row.pausedUntil }),
      { ruleId, totalCents: rule.priceCents },
    );
    const mayRide = input.standingPermission !== false;
    const underMandate = mayRide && decision?.outcome === "covered" ? ({ outcome: "mandate", mandateId: decision.mandateId, agreementVersion: agreement.version } as const) : null;
    const id = await refillOperation(() => callPropose(tx, circleId, ruleId, underMandate ?? plan));
    return { id, mandate: await mandateOutcome(tx, circleId, id, mayRide ? decision : null) };
  } catch (error) {
    if (error instanceof PurchaseError) throw new RefillError(error.reason);
    throw error;
  }
}

// What the proposal now says, not what was asked: a retry returns the refill already waiting.
async function mandateOutcome(tx: Transaction, circleId: string, proposalId: string, decision: ReturnType<typeof decideMandate>): Promise<RefillMandate> {
  const [row] = await tx.select({ plan: proposals.plan }).from(proposals).where(and(eq(proposals.circleId, circleId), eq(proposals.id, proposalId)));
  const plan = row?.plan as { outcome?: string; mandateId?: string } | undefined;
  if (plan?.outcome === "mandate" && typeof plan.mandateId === "string") return { outcome: "covered", mandateId: plan.mandateId };
  return decision?.outcome === "ask_parent" ? { outcome: "ask_parent", reason: decision.reason } : { outcome: "none" };
}

async function callPropose(tx: Transaction, circleId: string, ruleId: string, plan: unknown): Promise<string> {
  const result = await tx.execute<{ id: string }>(
    sql`select kin_private.propose_refill(${circleId}::uuid, ${ruleId}::uuid, ${JSON.stringify(plan)}::jsonb) as id`,
  );
  return requiredId(result.rows[0]?.id);
}

const REFILL_REASONS: Readonly<Record<string, RefillReason>> = {
  "42501": "refused", "23514": "invalid", "22P02": "invalid", "22007": "invalid", "22008": "invalid",
  KB006: "above_ceiling", KB007: "paused", KB008: "no_agreement",
  KB010: "demo_only", KB011: "above_limit", KB012: "over_budget", KB013: "seller_not_approved",
};

// The database's own refusals become typed reasons the screens can word.
async function refillOperation(work: () => Promise<string>): Promise<string> {
  try {
    return await work();
  } catch (error) {
    const reason = REFILL_REASONS[postgresError(error)?.code ?? ""];
    if (reason) throw new RefillError(reason);
    throw error;
  }
}

// The database asks the same question: does any active parent decide?
async function parentLevel(tx: Transaction, circleId: string): Promise<ParentLevel> {
  const parents = await tx
    .select({ level: members.parentLevel })
    .from(members)
    .where(and(eq(members.circleId, circleId), eq(members.role, "parent"), eq(members.status, "active")));
  return parents.some((parent) => parent.level === "decides") ? "decides" : "informed";
}

/** The circle's refill rules and purchases as the person looking may see them. */
export async function readPurchaseRecords(tx: Transaction, circleId: string, now: Date, timezone: string): Promise<{ purchaseRules: PurchaseRuleRecord[]; purchases: PurchaseRecord[] }> {
  const rules = await tx.select().from(purchaseRules).where(eq(purchaseRules.circleId, circleId)).orderBy(purchaseRules.createdAt, purchaseRules.id);
  const rows = await tx.select().from(purchases).where(eq(purchases.circleId, circleId)).orderBy(purchases.createdAt, purchases.id);
  // One query at a time: a transaction is one connection, and pg will refuse queries sent over it at once.
  const purchaseRuleRecords: PurchaseRuleRecord[] = [];
  for (const rule of rules) {
    purchaseRuleRecords.push({
      id: rule.id,
      payeeId: rule.payeeId,
      item: rule.item,
      category: rule.category,
      priceCents: rule.priceCents,
      limitCents: rule.limitCents,
      monthlyBudgetCents: rule.monthlyBudgetCents,
      committedCents: await committedThisMonth(tx, circleId, rule.id, now, timezone),
    });
  }
  return {
    purchaseRules: purchaseRuleRecords,
    purchases: rows.map((row) => ({
      id: row.id,
      ruleId: row.ruleId,
      proposalId: row.proposalId,
      item: row.item,
      cents: row.cents,
      state: row.state,
      merchantOrder: row.merchantOrder,
      orderedAt: row.orderedAt,
      deliveredAt: row.deliveredAt,
    })),
  };
}

/** One approved refill, as the worker needs it. Read inside the circle's service scope. */
export type PurchaseJob = {
  readonly executionId: string;
  readonly circleId: string;
  readonly proposalId: string;
  readonly purchaseId: string;
  readonly item: string;
  readonly category: string;
  readonly cents: number;
  readonly currency: string;
  readonly idempotencyKey: string;
  readonly state: ExecutionState;
  /** The mandate that approved this refill, and the most it allowed for a purchase, or `null` when the family said yes. */
  readonly mandate: { readonly id: string; readonly allowanceCents: number } | null;
  /** A demo circle's purchase is simulated: no PayPal charge, and labelled so. */
  readonly simulated: boolean;
  readonly now: Date;
  readonly timezone: string;
  readonly pausedUntil: Date | null;
};

/** The execution and everything around it, locked for this transaction. `null` if it is not this circle's refill. */
export async function readPurchaseJob(tx: Transaction, executionId: string, realNow: Date): Promise<PurchaseJob | null> {
  const [row] = await tx
    .select({
      executionId: executions.id,
      circleId: executions.circleId,
      proposalId: executions.proposalId,
      idempotencyKey: executions.idempotencyKey,
      state: executions.state,
      kind: proposals.kind,
      purchaseId: purchases.id,
      item: purchases.item,
      cents: purchases.cents,
      category: purchaseRules.category,
      mandateId: mandates.id,
      allowanceCents: mandates.perPurchaseCents,
      currency: circles.currency,
      demo: circles.demo,
      clockAt: circles.clockAt,
      timezone: circles.timezone,
      pausedUntil: circles.pausedUntil,
    })
    .from(executions)
    .innerJoin(proposals, and(eq(proposals.circleId, executions.circleId), eq(proposals.id, executions.proposalId)))
    .innerJoin(purchases, and(eq(purchases.circleId, proposals.circleId), eq(purchases.proposalId, proposals.id)))
    .innerJoin(purchaseRules, and(eq(purchaseRules.circleId, purchases.circleId), eq(purchaseRules.id, purchases.ruleId)))
    .innerJoin(circles, eq(circles.id, executions.circleId))
    .leftJoin(mandateUses, and(eq(mandateUses.circleId, proposals.circleId), eq(mandateUses.proposalId, proposals.id)))
    .leftJoin(mandates, and(eq(mandates.circleId, mandateUses.circleId), eq(mandates.id, mandateUses.mandateId)))
    .where(eq(executions.id, executionId))
    .for("update", { of: executions });
  if (!row || row.kind !== "purchase") return null;
  const now = row.clockAt ?? realNow;
  return {
    executionId: row.executionId,
    circleId: row.circleId,
    proposalId: row.proposalId,
    purchaseId: row.purchaseId,
    item: row.item,
    category: row.category,
    cents: row.cents,
    currency: row.currency,
    idempotencyKey: row.idempotencyKey,
    state: row.state,
    mandate: row.mandateId === null || row.allowanceCents === null ? null : { id: row.mandateId, allowanceCents: row.allowanceCents },
    simulated: row.demo,
    now,
    timezone: row.timezone,
    pausedUntil: laterOf(row.pausedUntil, await outgoingMoneyHeldByPresence(tx, row.circleId, realNow, now)),
  };
}

export type PurchaseBegin = "ready" | "paused" | "waiting_for_funds" | "wish_hold";

/**
 * Readies an approved refill to be bought: the proposal moves to executing.
 * It stops, changing nothing, while the circle is paused or the pool has not
 * received enough money (AGENTS.md section 5, rule 8).
 */
export async function beginPurchase(tx: Transaction, job: PurchaseJob): Promise<PurchaseBegin> {
  if (isPaused(job.pausedUntil, job.now)) return "paused";
  // A refill is discretionary: while the parent's wishes pause discretionary spending, it waits.
  if ((await readDiscretionaryPause(tx, job.circleId)).paused) return "wish_hold";
  const ledger = await readLedger(tx, { id: job.circleId, currency: job.currency });
  if (!canPayOut(ledger, { cents: job.cents, feeCents: 0, alreadyOwed: false })) return "waiting_for_funds";
  await tx.update(proposals).set({ state: "executing" }).where(and(eq(proposals.id, job.proposalId), eq(proposals.state, "approved")));
  return "ready";
}

/** Records, once per reason, why a purchase waits. */
export async function recordPurchaseHeld(tx: Transaction, job: PurchaseJob, reason: Exclude<PurchaseBegin, "ready">): Promise<void> {
  const [last] = await tx
    .select({ details: auditLog.details })
    .from(auditLog)
    .where(and(eq(auditLog.circleId, job.circleId), eq(auditLog.subjectId, job.executionId), eq(auditLog.action, "purchase.held")))
    .orderBy(sql`${auditLog.sequence} desc`)
    .limit(1);
  if ((last?.details as { reason?: string } | undefined)?.reason === reason) return;
  await audit(tx, job, "purchase.held", { reason });
}

/**
 * The seller has the order. Its reference is recorded once, the delivery
 * starts, and a delivery message is queued so the worker follows the order
 * to the door.
 */
export async function recordOrderPlaced(tx: Transaction, job: PurchaseJob, order: { readonly ref: string; readonly at: Date; readonly firstLookInSeconds: number }): Promise<void> {
  await moveExecution(tx, job, "created", "submitted", { submittedAt: order.at, attempts: sql`${executions.attempts} + 1` });
  await tx.update(purchases).set({ state: "ordered", merchantOrder: order.ref, orderedAt: order.at }).where(and(eq(purchases.id, job.purchaseId), eq(purchases.state, "awaiting")));
  await tx.insert(outbox).values({
    id: randomUUID(),
    circleId: job.circleId,
    topic: DELIVERY_TOPIC,
    payload: { purchaseId: job.purchaseId },
    availableAt: new Date(order.at.getTime() + order.firstLookInSeconds * 1000),
  });
}

/**
 * The money has left the pool: the only point at which Kin records a refill
 * as bought. The capture goes to the ledger once, by its own ID, and the
 * proposal settles.
 */
export async function confirmPurchase(tx: Transaction, job: PurchaseJob, paid: { readonly itemId: string; readonly at: Date }): Promise<void> {
  if (!(await entryExists(tx, job.circleId, "paypal_event", paid.itemId))) {
    const entry = purchaseCaptured(
      { ...header(job, "paypal_event", paid.itemId, paid.at), description: job.simulated ? `${job.item} bought (simulated)` : `${job.item} bought through PayPal` },
      { category: job.category, cents: job.cents },
    );
    await writeEntries(tx, [entry], await readAccountIds(tx, job.circleId));
  }
  await moveExecution(tx, job, "submitted", "confirmed", { paypalItemId: paid.itemId, confirmedAt: paid.at });
  await tx.update(proposals).set({ state: "settled" }).where(and(eq(proposals.id, job.proposalId), eq(proposals.state, "executing")));
  await audit(tx, job, "purchase.confirmed", { itemId: paid.itemId, simulated: job.simulated, mandateId: job.mandate?.id ?? null });
}

/** The refill will not be bought. Nothing left the pool, so the ledger is untouched. */
export async function failPurchase(tx: Transaction, job: PurchaseJob, reason: string): Promise<void> {
  if (job.state === "created") await moveExecution(tx, job, "created", "submitted", {});
  await moveExecution(tx, job, "submitted", "failed", { lastError: reason });
  await tx.update(proposals).set({ state: "failed" }).where(and(eq(proposals.id, job.proposalId), eq(proposals.state, "executing")));
  await audit(tx, job, "purchase.failed", { reason });
}

/** A purchase as the delivery step needs it, locked for this transaction. */
export type DeliveryJob = { readonly purchaseId: string; readonly state: DeliveryState; readonly orderedAt: Date | null; readonly merchantOrder: string | null };

export async function readDeliveryJob(tx: Transaction, purchaseId: string): Promise<DeliveryJob | null> {
  const [row] = await tx
    .select({ purchaseId: purchases.id, state: purchases.state, orderedAt: purchases.orderedAt, merchantOrder: purchases.merchantOrder })
    .from(purchases)
    .where(eq(purchases.id, purchaseId))
    .for("update");
  return row ?? null;
}

/** Moves the delivery one step along. The database refuses any step its diagram does not draw. */
export async function recordDelivery(tx: Transaction, circleId: string, job: DeliveryJob, to: DeliveryState, at: Date): Promise<void> {
  await tx
    .update(purchases)
    .set({ state: to, ...(to === "delivered" ? { deliveredAt: at } : {}) })
    .where(and(eq(purchases.id, job.purchaseId), eq(purchases.state, job.state)));
  await tx.insert(auditLog).values({ id: randomUUID(), circleId, actor: "service", action: "purchase.delivery", subjectType: "proposal", subjectId: null, details: { purchaseId: job.purchaseId, state: to }, origin: "worker" });
}
