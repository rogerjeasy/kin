import { WISH_SUBSCRIPTION_TOPIC, asService, claimOutbox, finishMessage, readSubscriptionJob, recordSubscriptionMoved, retryMessageLater, type ClaimedMessage, type Database } from "@kin/db";
import { PayPalError, subscriptionChangeRequestId, subscriptionMoveOutcome, type PayPalPool } from "@kin/paypal";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

export type WishSubscriptionDeps = {
  /** Connected as `kin_service`. Every transaction names the one circle it acts for. */
  readonly db: Database;
  readonly pool: Pick<PayPalPool, "changeSubscription" | "getSubscription">;
  readonly now: () => Date;
};

const BATCH = 10;
const LEASE_SECONDS = 120;
const MAX_BACKOFF_SECONDS = 3_600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** What the subscriber sees on PayPal. It names no one and no reason beyond her own wish. */
const REASONS = { suspend: "Paused by Kin, as the subscriber asked in advance", activate: "Resumed by Kin: the subscriber is home" } as const;

type Action = keyof typeof REASONS;

/**
 * Leases the subscriptions her wishes suspend or resume, asks PayPal, and
 * records the move only once PayPal's record, read back, shows it
 * (AGENTS.md section 5, rules 3 and 5). A demo circle's subscriptions are
 * simulated and never queued. The request ID is the message's, so a lease
 * handed out twice or retried after a lost answer asks PayPal once.
 */
export async function runWishSubscriptionBatch(deps: WishSubscriptionDeps, log: InboxLog): Promise<number> {
  const messages = await claimOutbox(deps.db, WISH_SUBSCRIPTION_TOPIC, BATCH, LEASE_SECONDS);
  for (const message of messages) await handle(deps, log, message);
  return messages.length;
}

async function handle(deps: WishSubscriptionDeps, log: InboxLog, message: ClaimedMessage): Promise<void> {
  const ask = askOf(message.payload);
  const done = () => asService(deps.db, message.circleId, (tx) => finishMessage(tx, message.id));
  if (ask === null) {
    log({ level: "error", message: "wish_subscription.unreadable_message", messageId: message.id });
    await done();
    return;
  }
  const job = await asService(deps.db, message.circleId, (tx) => readSubscriptionJob(tx, ask.subscriptionId));
  const expected = ask.action === "suspend" ? "suspending" : "resuming";
  if (job === null || job.simulated || job.paypalSubscriptionId === null || job.state !== expected) {
    await done();
    return;
  }
  const paypalId = job.paypalSubscriptionId;
  let refused = false;
  try {
    await deps.pool.changeSubscription(paypalId, ask.action, REASONS[ask.action], subscriptionChangeRequestId(job.id, ask.action, message.id));
  } catch (error) {
    // A refusal is PayPal's answer; anything else may or may not have landed, so the record decides.
    if (!(error instanceof PayPalError)) throw error;
    refused = error.outcome === "rejected";
  }
  try {
    const read = await deps.pool.getSubscription(paypalId);
    const outcome = subscriptionMoveOutcome(ask.action, read.status);
    if (outcome === "not_moved" && !refused) {
      await later(deps, log, message, job.id);
      return;
    }
    const to = outcome === "moved" ? (ask.action === "suspend" ? "suspended" : "active") : outcome === "gone" ? "suspended" : ask.action === "suspend" ? "active" : "suspended";
    await asService(deps.db, message.circleId, async (tx) => {
      const locked = await readSubscriptionJob(tx, job.id);
      if (locked !== null && locked.state === expected) await recordSubscriptionMoved(tx, locked, to, outcome === "moved" ? "confirmed" : outcome === "gone" ? "gone" : "refused", deps.now());
      await finishMessage(tx, message.id);
    });
    log({ level: outcome === "moved" ? "info" : "error", message: `wish_subscription.${ask.action}.${outcome === "not_moved" ? "refused" : outcome}`, circleId: message.circleId, subscriptionId: job.id });
  } catch (error) {
    if (!(error instanceof PayPalError)) throw error;
    await later(deps, log, message, job.id);
  }
}

async function later(deps: WishSubscriptionDeps, log: InboxLog, message: ClaimedMessage, subscriptionId: string): Promise<void> {
  const seconds = Math.min(MAX_BACKOFF_SECONDS, 30 * 2 ** Math.min(message.attempts, 7));
  log({ level: "info", message: "wish_subscription.retry", circleId: message.circleId, subscriptionId, seconds });
  await asService(deps.db, message.circleId, (tx) => retryMessageLater(tx, message.id, seconds));
}

function askOf(payload: unknown): { readonly subscriptionId: string; readonly action: Action } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const id = record["subscriptionId"];
  const action = record["action"];
  if (typeof id !== "string" || !UUID.test(id) || (action !== "suspend" && action !== "activate")) return null;
  return { subscriptionId: id, action };
}
