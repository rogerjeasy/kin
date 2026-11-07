import { authorize, type CircleAction } from "@kin/auth";
import {
  CaregiverBillingError,
  NothingToSettleError,
  SettlementExistsError,
  asPerson,
  decideReceipt,
  proposeSettlement,
  setOwnSettlementReceiver,
  submitReceipt,
  type CaregiverBillingReason,
  type CircleSnapshot,
  type Database,
} from "@kin/db";
import { InvalidDecimalError, ReceiptError, SettlementProposalError, calendarDay, centsFromDecimal, checkReceipt } from "@kin/domain";
import { payoutFeeReserve } from "@kin/paypal";

import { openPeriod } from "@/content/circle/period";

export type SettlementContext = { readonly db: Database; readonly userId: string; readonly circle: CircleSnapshot };
export type SettlementFailure =
  | "refused" | "invalid" | "not_waiting" | "paused" | "above_ceiling" | "no_agreement"
  | "receiver" | "payment_in_progress" | "settlement_exists" | "nothing_to_settle" | "unavailable";
export type SettlementResult = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly reason: SettlementFailure };

const ACTIONS = {
  receipt_submit: "receipt.submit",
  receipt_decide: "receipt.decide",
  propose: "settlement.propose",
  receiver: "settlement_receiver.set",
} as const satisfies Record<string, CircleAction>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The one request boundary for receipts and the month's settlement: a member
 * files a receipt, another member decides on it, an organizer puts the
 * settlement to the family, and a member says where their own payout goes.
 * Nothing typed in the browser is trusted: the amount is read digit by digit,
 * the receipt is checked by the money core, and the database checks it again.
 */
export async function runSettlement(context: SettlementContext, input: unknown): Promise<SettlementResult> {
  const row = record(input);
  const operation = row && Object.hasOwn(ACTIONS, String(row.operation)) ? (row.operation as keyof typeof ACTIONS) : null;
  if (row === null || operation === null) return refusal("invalid");
  if (!authorize({ role: context.circle.viewer.role, status: "active" }, ACTIONS[operation]).allowed) return refusal("refused");
  try {
    if (operation === "receipt_submit") return await file(context, row);
    if (operation === "receipt_decide") return await decide(context, row);
    if (operation === "propose") return await propose(context, row);
    return await receiver(context, row);
  } catch (error) {
    if (error instanceof ReceiptError || error instanceof InvalidDecimalError) return refusal("invalid");
    if (error instanceof NothingToSettleError) return refusal("nothing_to_settle");
    if (error instanceof SettlementExistsError) return refusal("settlement_exists");
    if (error instanceof SettlementProposalError) return refusal(error.reason === "not_a_member" ? "refused" : error.reason);
    if (error instanceof CaregiverBillingError) return refusal(failureOf(error.reason));
    throw error;
  }
}

async function file(context: SettlementContext, row: Record<string, unknown>): Promise<SettlementResult> {
  if (!keys(row, ["operation", "id", "category", "amount", "description", "spentOn"]) || typeof row.id !== "string" || !UUID.test(row.id) || typeof row.amount !== "string") return refusal("invalid");
  const { currency, now, timezone } = context.circle.circle;
  const receipt = checkReceipt({ category: row.category, cents: centsFromDecimal(row.amount.trim(), currency), description: row.description, spentOn: row.spentOn }, calendarDay(now, timezone).occurredOn);
  const id = row.id;
  await asPerson(context.db, context.userId, (tx) => submitReceipt(tx, { circleId: context.circle.circle.id, id, receipt }));
  return { ok: true, id };
}

async function decide(context: SettlementContext, row: Record<string, unknown>): Promise<SettlementResult> {
  if (!keys(row, ["operation", "receiptId", "approve"]) || typeof row.receiptId !== "string" || !UUID.test(row.receiptId) || typeof row.approve !== "boolean") return refusal("invalid");
  const { receiptId, approve } = row;
  await asPerson(context.db, context.userId, (tx) => decideReceipt(tx, { circleId: context.circle.circle.id, receiptId, approve }));
  return { ok: true, id: receiptId };
}

// The period is the one open on the circle's clock, never one the browser names.
async function propose(context: SettlementContext, row: Record<string, unknown>): Promise<SettlementResult> {
  if (!keys(row, ["operation"])) return refusal("invalid");
  const { circle } = context;
  const id = await asPerson(context.db, context.userId, (tx) =>
    proposeSettlement(tx, { circleId: circle.circle.id, period: openPeriod(circle), now: circle.circle.now, payoutFee: payoutFeeReserve(circle.circle.currency) }),
  );
  return { ok: true, id };
}

async function receiver(context: SettlementContext, row: Record<string, unknown>): Promise<SettlementResult> {
  if (!keys(row, ["operation", "email"]) || typeof row.email !== "string") return refusal("invalid");
  const email = row.email;
  await asPerson(context.db, context.userId, (tx) => setOwnSettlementReceiver(tx, { circleId: context.circle.circle.id, email }));
  return { ok: true, id: context.circle.viewer.memberId };
}

function failureOf(reason: CaregiverBillingReason): SettlementFailure {
  switch (reason) {
    case "invalid":
    case "key_reused":
      return "invalid";
    case "not_waiting":
    case "paused":
    case "above_ceiling":
    case "no_agreement":
    case "receiver":
    case "payment_in_progress":
      return reason;
    default:
      // The caregiver-billing reasons that no receipt or settlement can raise.
      return "refused";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function keys(row: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(row).every((key) => allowed.includes(key));
}
function refusal(reason: SettlementFailure): SettlementResult {
  return { ok: false, reason };
}
