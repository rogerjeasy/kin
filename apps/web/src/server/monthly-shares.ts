import { asPerson, MonthlyShareError, moveMonthlyShare, startMonthlyShare, type CircleSnapshot, type Database, type MonthlyShareReason } from "@kin/db";
import { centsFromDecimal, checkMonthlyShare, InvalidDecimalError, type TopUpCheck } from "@kin/domain";
import { PayPalError, type Inbox, type PayPalPool } from "@kin/paypal";
import { randomUUID } from "node:crypto";

import { may } from "./dashboard-context";
import { typedAmount } from "@/lib/typed-amount";

type Services = { readonly pool: PayPalPool; readonly inbox: Inbox };

export type ShareContext = {
  readonly db: Database;
  readonly userId: string;
  readonly circle: CircleSnapshot;
  /** `null` when this deployment has no PayPal app or no queue: monthly shares are then off. */
  readonly services: Services | null;
  /** Where PayPal returns the member after approving, and what it calls the subscription. */
  readonly returnUrl: string;
  readonly description: string;
};

export type ShareFailure = "invalid" | "amount" | "unavailable" | "paypal" | MonthlyShareReason | Extract<TopUpCheck, { ok: false }>["reason"];

export type ShareResult =
  /** A real share waits for the member at `approvalUrl`; a demo share runs at once and has none. */
  | { readonly ok: true; readonly approvalUrl: string | null }
  | { readonly ok: false; readonly reason: ShareFailure };

const OPERATIONS = ["start", "pause", "resume", "cancel", "check"] as const;
type Operation = (typeof OPERATIONS)[number];

/**
 * The one request boundary for a member's monthly share: start it, pause it,
 * resume it, end it, or ask for it to be read back from PayPal (the member has
 * just come back from approving it). Every operation is on the viewer's own
 * share; the database checks that again. PayPal is asked first, and the
 * record changes only once it has agreed, so Kin never shows a share paused
 * that PayPal still charges.
 */
export async function runMonthlyShare(context: ShareContext, input: unknown): Promise<ShareResult> {
  const row = object(input);
  const operation = row !== null && OPERATIONS.includes(row["operation"] as Operation) ? (row["operation"] as Operation) : null;
  if (row === null || operation === null) return refusal("invalid");
  if (!may(context.circle, "money.contribute")) return refusal("refused");
  if (context.services === null) return refusal("unavailable");
  try {
    if (operation === "start") return await start(context, context.services, row);
    return await change(context, context.services, operation, row);
  } catch (error) {
    if (error instanceof MonthlyShareError) return refusal(error.reason);
    if (error instanceof PayPalError) return refusal("paypal");
    if (error instanceof InvalidDecimalError) return refusal("amount");
    throw error;
  }
}

async function start(context: ShareContext, services: Services, row: Record<string, unknown>): Promise<ShareResult> {
  if (!hasOnly(row, ["operation", "amount"]) || typeof row["amount"] !== "string") return refusal("invalid");
  const { circle } = context;
  const amount = { cents: centsFromDecimal(typedAmount(row["amount"]), circle.circle.currency), currency: circle.circle.currency };
  const check = checkMonthlyShare(amount);
  if (!check.ok) return refusal(check.reason);
  if (circle.monthlyShares.some((share) => share.memberId === circle.viewer.memberId && share.state !== "cancelled" && share.state !== "approval_pending")) return refusal("running");

  const id = randomUUID();
  // A demo circle's share is simulated: no PayPal subscription is made.
  const subscription = circle.circle.demo
    ? null
    : await services.pool.createSubscription({ amount, reference: { circleId: circle.circle.id, memberId: circle.viewer.memberId }, description: context.description, returnUrl: context.returnUrl }, id);
  await asPerson(context.db, context.userId, (tx) =>
    startMonthlyShare(tx, { circleId: circle.circle.id, id, cents: amount.cents, paypalSubscriptionId: subscription?.subscriptionId ?? null, approvalUrl: subscription?.approvalUrl ?? null }),
  );
  // A demo share's first month is recorded by the worker; a real one waits for approval.
  if (subscription === null) await tell(services.inbox, circle.circle.id, id);
  return { ok: true, approvalUrl: subscription?.approvalUrl ?? null };
}

async function change(context: ShareContext, services: Services, operation: Exclude<Operation, "start">, row: Record<string, unknown>): Promise<ShareResult> {
  if (!hasOnly(row, ["operation"])) return refusal("invalid");
  const { circle } = context;
  // The viewer's own live share: the one a member may pause, resume or end.
  const share = circle.monthlyShares.find((each) => each.memberId === circle.viewer.memberId && each.state !== "cancelled");
  if (share === undefined) return refusal("refused");
  if (operation === "check") {
    await tell(services.inbox, circle.circle.id, share.id);
    return { ok: true, approvalUrl: share.approvalUrl };
  }
  const action = operation === "pause" ? "suspend" : operation === "resume" ? "activate" : "cancel";
  if (share.paypalSubscriptionId !== null) {
    // A fresh request ID for each ask: pausing twice over a month are two actions, not one repeated.
    await services.pool.changeSubscription(share.paypalSubscriptionId, action, `${context.description}: ${operation}`, `kin-share-${action}-${share.id}-${randomUUID()}`);
  }
  await asPerson(context.db, context.userId, (tx) => moveMonthlyShare(tx, { circleId: circle.circle.id, shareId: share.id, state: operation === "pause" ? "paused" : operation === "resume" ? "active" : "cancelled" }));
  await tell(services.inbox, circle.circle.id, share.id);
  return { ok: true, approvalUrl: null };
}

/** Asks the worker to read the share back. PayPal's webhook says the same if this message is lost. */
async function tell(inbox: Inbox, circleId: string, subscriptionId: string): Promise<void> {
  try {
    await inbox.send({ kind: "subscription_checked", circleId, subscriptionId, requestId: randomUUID() });
  } catch (error) {
    console.error(JSON.stringify({ message: "monthly_share.inbox_unavailable", error: error instanceof Error ? error.name : "unknown" }));
  }
}

function refusal(reason: ShareFailure): ShareResult {
  return { ok: false, reason };
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function hasOnly(row: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(row).every((key) => keys.includes(key));
}
