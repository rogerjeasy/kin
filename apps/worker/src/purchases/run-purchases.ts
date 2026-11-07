import { DELIVERY_TOPIC, PURCHASE_TOPIC, asService, claimOutbox, finishMessage, retryMessageLater, type ClaimedMessage } from "@kin/db";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

import { executePurchase, followDelivery, type PurchaseDeps } from "./execute-purchase.ts";

const BATCH = 5;
const LEASE_SECONDS = 120;
/** A message that keeps failing is looked at less and less often, up to once an hour. */
const MAX_BACKOFF_SECONDS = 3_600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Leases the approved refills waiting in the outbox and buys each one. */
export async function runPurchaseBatch(deps: PurchaseDeps, log: InboxLog): Promise<number> {
  return run(deps, log, PURCHASE_TOPIC, "executionId", async (circleId, id) => {
    const step = await executePurchase(deps, circleId, id);
    log({ level: step.result === "failed" ? "error" : "info", message: `purchase.${step.result}`, circleId, executionId: id });
    return step.next === "done" ? null : step.seconds;
  });
}

/** Leases the orders still on their way and records how far each has got. */
export async function runDeliveryBatch(deps: PurchaseDeps, log: InboxLog): Promise<number> {
  return run(deps, log, DELIVERY_TOPIC, "purchaseId", async (circleId, id) => {
    const step = await followDelivery(deps, circleId, id);
    log({ level: "info", message: step.next === "done" ? "purchase.delivered" : "purchase.on_its_way", circleId, purchaseId: id });
    return step.next === "done" ? null : step.seconds;
  });
}

type Turn = (circleId: string, id: string) => Promise<number | null>;

async function run(deps: PurchaseDeps, log: InboxLog, topic: string, field: string, turn: Turn): Promise<number> {
  const messages = await claimOutbox(deps.db, topic, BATCH, LEASE_SECONDS);
  for (const message of messages) await handle(deps, log, message, field, turn);
  return messages.length;
}

// A turn that is done leaves the outbox; one that waits comes back later; one that throws comes back after a growing pause.
async function handle(deps: PurchaseDeps, log: InboxLog, message: ClaimedMessage, field: string, turn: Turn): Promise<void> {
  const id = idOf(message.payload, field);
  if (id === null) {
    log({ level: "error", message: "purchase.unreadable_message", messageId: message.id });
    await asService(deps.db, message.circleId, (tx) => finishMessage(tx, message.id));
    return;
  }
  try {
    const seconds = await turn(message.circleId, id);
    await asService(deps.db, message.circleId, (tx) => (seconds === null ? finishMessage(tx, message.id) : retryMessageLater(tx, message.id, seconds)));
  } catch (error) {
    const seconds = Math.min(MAX_BACKOFF_SECONDS, 30 * 2 ** Math.min(message.attempts, 7));
    // Never an error's message: a database error can quote the query's values (AGENTS.md section 6).
    log({ level: "error", message: "purchase.retry", circleId: message.circleId, id, seconds, error: { name: error instanceof Error ? error.name : "unknown" } });
    await asService(deps.db, message.circleId, (tx) => retryMessageLater(tx, message.id, seconds));
  }
}

function idOf(payload: unknown, field: string): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as Record<string, unknown>)[field];
  return typeof id === "string" && UUID.test(id) ? id : null;
}
