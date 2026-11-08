import { MAX_DESCRIPTION_LENGTH, ModelUnavailableError, byClaude, readVisits, reasonForFailure, type FallbackReason, type Provenance, type StructuredModel } from "@kin/agent";
import { caregiverAccess, type BillingAccount, type CaregiverAction } from "@kin/auth";
import { asPerson, CaregiverBillingError, configureCaregiver, declineCaregiverBill, sendCaregiverBill, setOwnReceiver, submitCaregiverBill, type CircleSnapshot, type Database, type CaregiverBillingReason } from "@kin/db";
import { calculateCaregiverBill, CaregiverBillError, calendarDay, centsFromDecimal, InvalidDecimalError, type CaregiverBill } from "@kin/domain";
import { randomUUID } from "node:crypto";

import { spendUse, type RateLimiter } from "./model";
import { typedAmount } from "@/lib/typed-amount";

export type BillingContext = {
  readonly db: Database;
  readonly userId: string;
  readonly circle: CircleSnapshot;
  readonly accountTypes: BillingAccount;
  /** Claude, to read a description of visits; `null` when this deployment has none. */
  readonly model?: StructuredModel | null;
  /** Per person. */
  readonly limiter?: RateLimiter;
  /** For the whole server, whoever asks. */
  readonly budget?: RateLimiter;
  readonly now?: () => number;
};
export type BillingFailure = CaregiverBillingReason | CaregiverBillError["reason"] | "unavailable" | "model_unavailable" | "model_refused" | "description" | "busy";
/** Days Claude read from a description, each with the caregiver's own words it was traced to, and who read them. */
export type DescribedVisits = {
  readonly visits: readonly { readonly date: string; readonly minutes: number; readonly quotes: readonly string[] }[];
  readonly unclear: readonly string[];
  readonly dropped: number;
  readonly provenance: Provenance;
};
export type BillingResult =
  | { readonly ok: true; readonly bill: CaregiverBill; readonly submissionKey: string }
  | ({ readonly ok: true; readonly described: true } & DescribedVisits)
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: BillingFailure; readonly billId?: string; /** When the model was not used, why, so the screen never leaves it unsaid. */ readonly why?: FallbackReason };

const ACTIONS = {
  configure: "caregiver_rate.manage",
  review: "caregiver_bill.submit",
  submit: "caregiver_bill.submit",
  send: "caregiver_bill.review",
  decline: "caregiver_bill.review",
  receiver: "caregiver_receiver.set",
  describe: "caregiver_bill.submit",
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
    if (operation === "describe") return await describe(context, row);
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
  const rateCentsPerHour = centsFromDecimal(typedAmount(row.rate), context.circle.circle.currency);
  const { memberId, name, payeeId } = row;
  const id = await asPerson(context.db, context.userId, (tx) => configureCaregiver(tx, { circleId: context.circle.circle.id, memberId, payeeId, name, rateCentsPerHour }));
  return { ok: true, id };
}

async function describe(context: BillingContext, row: Record<string, unknown>): Promise<BillingResult> {
  if (!keys(row, ["operation", "description"]) || typeof row.description !== "string") return refusal("invalid");
  return readDescription(context, row.description);
}

/**
 * Claude reads a description of visits into service days and durations, to
 * fill in a form or to show a preview. Nothing is stored and nothing is
 * valued: the description is the only thing sent, so no rate ever reaches the
 * model. The caller has already decided that this person may ask.
 */
export async function readDescription(context: BillingContext, description: string): Promise<BillingResult> {
  const model = context.model ?? null;
  if (model === null) return refusal("model_unavailable", "not_configured");
  if (description.trim() === "" || description.length > MAX_DESCRIPTION_LENGTH) return refusal("description");
  if (!spendUse(context, context, (context.now ?? Date.now)())) return refusal("busy", "limit_reached");
  const { now, timezone } = context.circle.circle;
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: timezone }).format(now);
  try {
    const result = await readVisits(model, { description, today: calendarDay(now, timezone).occurredOn, weekday, timezone });
    if (result.kind === "refused") return refusal("model_refused", "model_refused");
    if (result.kind === "unreadable") return refusal("description", "unreadable");
    return { ok: true, described: true, visits: result.visits, unclear: result.unclear, dropped: result.dropped, provenance: byClaude(model) };
  } catch (error) {
    if (error instanceof ModelUnavailableError) return refusal("model_unavailable", reasonForFailure(error));
    throw error;
  }
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
function refusal(reason: BillingFailure, why?: FallbackReason): BillingResult {
  return { ok: false, reason, ...(why === undefined ? {} : { why }) };
}
