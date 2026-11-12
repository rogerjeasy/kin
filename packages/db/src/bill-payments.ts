import { billRoute, calendarDay, outsideReceiptCategory, planBillPayment, type BillReview, type BillRoute, type ParentLevel } from "@kin/domain";
import { and, eq, sql } from "drizzle-orm";

import { readAgreementVersions } from "./agreements.ts";
import { postgresError } from "./caregiver-billing.ts";
import type { Transaction } from "./connection.ts";
import { bills, circles, members, payees } from "./schema/index.ts";

export type BillPaymentReason =
  | "refused" | "invalid" | "not_waiting" | "above_ceiling" | "paused" | "no_agreement" | "payment_in_progress" | "payee_fixed" | "key_reused";

/** The database refused a bill's review or its record of payment. Retrying the same request cannot help. */
export class BillPaymentError extends Error {
  readonly retryable = false;
  readonly reason: BillPaymentReason;
  constructor(reason: BillPaymentReason) {
    super(`Bill payment refused: ${reason}`);
    this.reason = reason;
    this.name = "BillPaymentError";
  }
}

const REASONS: Readonly<Record<string, BillPaymentReason>> = {
  "42501": "refused", "23514": "invalid", "22P02": "invalid", "22007": "invalid", "22008": "invalid", "23505": "not_waiting",
  KB004: "key_reused", KB005: "not_waiting", KB006: "above_ceiling", KB007: "paused", KB008: "no_agreement", KB009: "payment_in_progress", KB017: "payee_fixed",
};

async function operation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = REASONS[postgresError(error)?.code ?? ""];
    if (reason) throw new BillPaymentError(reason);
    throw error;
  }
}

export type BillReviewInput = { readonly circleId: string; readonly billId: string; readonly review: BillReview; readonly now: Date };
export type BillReviewed = { readonly route: BillRoute; readonly proposalId: string | null };

/**
 * Confirms a bill read from a letter, as the person, inside `asPerson`. A
 * payee with a PayPal address gets a bill_payment proposal planned by the
 * agreement in force; one without is kept for a member to pay outside Kin.
 * The database operation rechecks the role, the bill, the payee and the plan.
 */
export async function reviewBill(tx: Transaction, input: BillReviewInput): Promise<BillReviewed> {
  const { circleId, billId, review } = input;
  const plan = billRoute(review) === "paypal" ? await planFor(tx, input) : null;
  return operation(async () => {
    const result = await tx.execute<{ reviewed: { proposalId: string | null; route: BillRoute } }>(
      sql`select kin_private.review_bill(${circleId}::uuid, ${billId}::uuid, ${review.name}, ${review.cents}::bigint, ${review.dueOn}::date, ${review.receiver}, ${plan === null ? null : JSON.stringify(plan)}::jsonb) as reviewed`,
    );
    const reviewed = result.rows[0]?.reviewed;
    if (!reviewed) throw new Error("The bill review returned nothing");
    return { route: reviewed.route, proposalId: reviewed.proposalId };
  });
}

/** Files the person's receipt for a reviewed bill they paid outside Kin. Another member's yes credits it. */
export async function recordBillPaidOutside(tx: Transaction, input: { readonly circleId: string; readonly billId: string; readonly receiptId: string; readonly spentOn: string }): Promise<string> {
  const [payee] = await tx
    .select({ category: payees.category })
    .from(bills)
    .innerJoin(payees, and(eq(payees.circleId, bills.circleId), eq(payees.id, bills.payeeId)))
    .where(and(eq(bills.circleId, input.circleId), eq(bills.id, input.billId)));
  // A bill this person cannot read is refused by the operation, which is asked all the same.
  const category = outsideReceiptCategory(payee?.category ?? "other");
  return operation(async () => {
    const result = await tx.execute<{ id: string }>(
      sql`select kin_private.record_bill_paid_outside(${input.circleId}::uuid, ${input.billId}::uuid, ${input.receiptId}::uuid, ${category}, ${input.spentOn}::date) as id`,
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("The payment record returned no ID");
    return id;
  });
}

async function planFor(tx: Transaction, { circleId, billId, review, now }: BillReviewInput) {
  const [row] = await tx
    .select({ status: payees.status, pausedUntil: circles.pausedUntil, timezone: circles.timezone })
    .from(bills)
    .innerJoin(payees, and(eq(payees.circleId, bills.circleId), eq(payees.id, bills.payeeId)))
    .innerJoin(circles, eq(circles.id, bills.circleId))
    .where(and(eq(bills.circleId, circleId), eq(bills.id, billId)));
  if (!row) throw new BillPaymentError("refused");
  // Planned against the version in force, never one still waiting for acceptance.
  const { versions } = await readAgreementVersions(tx, circleId, calendarDay(now, row.timezone).occurredOn);
  const agreement = versions.find((version) => version.status === "in_force");
  if (!agreement) throw new BillPaymentError("no_agreement");
  const plan = planBillPayment({
    cents: review.cents,
    payeeStatus: row.status,
    agreement: { version: agreement.version, approvals: agreement.approvals },
    parentLevel: await parentLevel(tx, circleId),
    pausedUntil: row.pausedUntil,
    now,
  });
  if (plan.outcome === "paused") throw new BillPaymentError("paused");
  if (plan.outcome === "refused") throw new BillPaymentError("above_ceiling");
  return plan;
}

// The database asks the same question: does any active parent decide?
async function parentLevel(tx: Transaction, circleId: string): Promise<ParentLevel> {
  const parents = await tx
    .select({ level: members.parentLevel })
    .from(members)
    .where(and(eq(members.circleId, circleId), eq(members.role, "parent"), eq(members.status, "active")));
  return parents.some((parent) => parent.level === "decides") ? "decides" : "informed";
}
