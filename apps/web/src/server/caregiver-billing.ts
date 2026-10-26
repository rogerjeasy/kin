import { caregiverAccess, type BillingAccount, type CaregiverAction } from "@kin/auth";
import { asPerson, CaregiverBillingError, configureCaregiver, declineCaregiverBill, sendCaregiverBill, setOwnReceiver, submitCaregiverBill, type CircleSnapshot, type Database, type CaregiverBillingReason } from "@kin/db";
import { calculateCaregiverBill, CaregiverBillError, calendarDay, centsFromDecimal, InvalidDecimalError, type CaregiverBill } from "@kin/domain";
import { randomUUID } from "node:crypto";

export type BillingContext = { readonly db: Database; readonly userId: string; readonly circle: CircleSnapshot; readonly accountTypes: BillingAccount };
export type BillingFailure = CaregiverBillingReason | CaregiverBillError["reason"] | "unavailable";
export type BillingResult =
  | { readonly ok: true; readonly bill: CaregiverBill; readonly submissionKey: string }
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: BillingFailure; readonly billId?: string };

const ACTIONS = {
  configure: "caregiver_rate.manage",
  review: "caregiver_bill.submit",
  submit: "caregiver_bill.submit",
  send: "caregiver_bill.review",
  decline: "caregiver_bill.review",
  receiver: "caregiver_receiver.set",
} as const satisfies Record<string, CaregiverAction>;

/**
 * The one request boundary for rate setup, deterministic review, own-bill
 * submission, and the family's decision to send a bill for approval or decline it.
 */
export async function runCaregiverBilling(context: BillingContext, input: unknown): Promise<BillingResult> {
  const row = object(input);
  const operation = row && Object.hasOwn(ACTIONS, String(row.operation)) ? (row.operation as keyof typeof ACTIONS) : null;
  if (!row || operation === null) return refusal("invalid");
  const action = ACTIONS[operation];
  if (!caregiverAccess({ role: context.circle.viewer.role, status: "active" }, action, context.accountTypes)) return refusal("refused");
  try {
    if (operation === "configure") return await configure(context, row);
    if (operation === "review") return review(context.circle, row);
    if (operation === "send" || operation === "decline") return await decide(context, row, operation);
    if (operation === "receiver") return await receiver(context, row);
    return await submit(context, row);
  } catch (error) {
    if (error instanceof CaregiverBillingError && error.billId !== null) return { ok: false, reason: error.reason, billId: error.billId };
    if (error instanceof CaregiverBillError || error instanceof CaregiverBillingError) return refusal(error.reason);
    if (error instanceof InvalidDecimalError) return refusal("rate");
    throw error;
  }
}

async function configure(context: BillingContext, row: Record<string, unknown>): Promise<BillingResult> {
  if (!keys(row, ["operation", "memberId", "payeeId", "name", "rate"]) || typeof row.memberId !== "string" || typeof row.name !== "string" || typeof row.rate !== "string" || (row.payeeId !== null && typeof row.payeeId !== "string")) return refusal("invalid");
  const rateCentsPerHour = centsFromDecimal(row.rate.trim(), context.circle.circle.currency);
  const { memberId, name, payeeId } = row;
  const id = await asPerson(context.db, context.userId, (tx) => configureCaregiver(tx, { circleId: context.circle.circle.id, memberId, payeeId, name, rateCentsPerHour }));
  return { ok: true, id };
}

/** The caregiver says where their own pay goes. */
async function receiver(context: BillingContext, row: Record<string, unknown>): Promise<BillingResult> {
  if (!keys(row, ["operation", "email"]) || typeof row.email !== "string") return refusal("invalid");
  const email = row.email;
  await asPerson(context.db, context.userId, (tx) => setOwnReceiver(tx, { circleId: context.circle.circle.id, email }));
  return { ok: true, id: context.circle.viewer.memberId };
}

function review(circle: CircleSnapshot, row: Record<string, unknown>): BillingResult {
  if (!keys(row, ["operation", "visits"])) return refusal("invalid");
  const payee = circle.payees.find((each) => each.payee.member?.memberId === circle.viewer.memberId && each.caregiverRateCentsPerHour !== null);
  if (!payee) return refusal("missing_rate");
  const today = calendarDay(circle.circle.now, circle.circle.timezone).occurredOn;
  const bill = calculateCaregiverBill({ version: 1, currency: circle.circle.currency, rateCentsPerHour: payee.caregiverRateCentsPerHour, visits: row.visits }, today);
  return { ok: true, bill, submissionKey: randomUUID() };
}

async function submit(context: BillingContext, row: Record<string, unknown>): Promise<BillingResult> {
  if (!keys(row, ["operation", "details", "submissionKey"]) || typeof row.submissionKey !== "string") return refusal("invalid");
  const bill = calculateCaregiverBill(row.details, calendarDay(context.circle.circle.now, context.circle.circle.timezone).occurredOn);
  if (bill.details.currency !== context.circle.circle.currency) return refusal("invalid");
  const submissionKey = row.submissionKey;
  const id = await asPerson(context.db, context.userId, (tx) => submitCaregiverBill(tx, { circleId: context.circle.circle.id, details: bill.details, submissionKey }));
  return { ok: true, id };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Sends the bill for the family's approval, raising its proposal, or declines it. */
async function decide(context: BillingContext, row: Record<string, unknown>, operation: "send" | "decline"): Promise<BillingResult> {
  if (!keys(row, ["operation", "billId"]) || typeof row.billId !== "string" || !UUID.test(row.billId)) return refusal("invalid");
  const target = { circleId: context.circle.circle.id, billId: row.billId };
  if (operation === "decline") {
    await asPerson(context.db, context.userId, (tx) => declineCaregiverBill(tx, target));
    return { ok: true, id: row.billId };
  }
  const id = await asPerson(context.db, context.userId, (tx) => sendCaregiverBill(tx, { ...target, now: context.circle.circle.now }));
  return { ok: true, id };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function keys(row: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(row).every((key) => allowed.includes(key));
}
function refusal(reason: BillingFailure): BillingResult {
  return { ok: false, reason };
}
