import { authorize } from "@kin/auth";
import { BillPaymentError, asPerson, recordBillPaidOutside, reviewBill, type BillPaymentReason, type CircleSnapshot, type Database } from "@kin/db";
import { BillReviewError, InvalidDecimalError, centsFromDecimal, checkBillReview, type BillRoute } from "@kin/domain";

import { typedAmount } from "@/lib/typed-amount";

export type BillPaymentContext = { readonly db: Database; readonly userId: string; readonly circle: CircleSnapshot };
export type BillPaymentFailure = BillPaymentReason | BillReviewError["reason"] | "unavailable";
export type BillPaymentResult =
  | { readonly ok: true; readonly route: BillRoute; readonly proposalId: string | null }
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: BillPaymentFailure };

const OPERATIONS = ["review", "paid_outside"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The one request boundary for a bill read from a letter: a member who shares
 * the cost confirms it and says how it is paid, or records paying it outside
 * Kin. Nothing typed in the browser is trusted: the amount is read digit by
 * digit, the review is checked by the money core, and the database checks
 * everything again, the plan of approvals included.
 */
export async function runBillPayment(context: BillPaymentContext, input: unknown): Promise<BillPaymentResult> {
  const row = record(input);
  const operation = OPERATIONS.find((each) => each === row?.operation);
  if (row === null || operation === undefined) return refusal("invalid");
  if (!authorize({ role: context.circle.viewer.role, status: "active" }, "bill.review").allowed) return refusal("refused");
  try {
    return operation === "review" ? await review(context, row) : await paidOutside(context, row);
  } catch (error) {
    if (error instanceof BillReviewError) return refusal(error.reason);
    if (error instanceof InvalidDecimalError) return refusal("amount");
    if (error instanceof BillPaymentError) return refusal(error.reason);
    throw error;
  }
}

async function review(context: BillPaymentContext, row: Record<string, unknown>): Promise<BillPaymentResult> {
  if (!keys(row, ["operation", "billId", "name", "amount", "dueOn", "receiver"]) || typeof row.billId !== "string" || !UUID.test(row.billId) || typeof row.amount !== "string") return refusal("invalid");
  const { circle } = context.circle;
  const checked = checkBillReview({ name: row.name, cents: centsFromDecimal(typedAmount(row.amount), circle.currency), dueOn: row.dueOn ?? null, receiver: row.receiver ?? null });
  const billId = row.billId;
  const reviewed = await asPerson(context.db, context.userId, (tx) => reviewBill(tx, { circleId: circle.id, billId, review: checked, now: circle.now }));
  return { ok: true, ...reviewed };
}

async function paidOutside(context: BillPaymentContext, row: Record<string, unknown>): Promise<BillPaymentResult> {
  if (!keys(row, ["operation", "billId", "id", "spentOn"]) || typeof row.billId !== "string" || !UUID.test(row.billId) || typeof row.id !== "string" || !UUID.test(row.id) || typeof row.spentOn !== "string" || !DAY.test(row.spentOn)) return refusal("invalid");
  const { billId, id: receiptId, spentOn } = row as { billId: string; id: string; spentOn: string };
  const id = await asPerson(context.db, context.userId, (tx) => recordBillPaidOutside(tx, { circleId: context.circle.circle.id, billId, receiptId, spentOn }));
  return { ok: true, id };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
const keys = (row: Record<string, unknown>, allowed: readonly string[]) => Object.keys(row).every((key) => allowed.includes(key));
const refusal = (reason: BillPaymentFailure): BillPaymentResult => ({ ok: false, reason });
