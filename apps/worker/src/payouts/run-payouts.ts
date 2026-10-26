import { PAYOUT_TOPIC, asService, claimOutbox, finishMessage, retryMessageLater, type ClaimedMessage } from "@kin/db";
import { PayPalError } from "@kin/paypal";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

import { executePayout, type PayoutDeps } from "./execute-payout.ts";

/** How many approved payouts one turn takes, and how long each is hidden from a second worker. */
const BATCH = 5;
const LEASE_SECONDS = 120;
/** A message that keeps failing is looked at less and less often, up to once an hour. */
const MAX_BACKOFF_SECONDS = 3_600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Leases the approved payouts waiting in the outbox and carries each one
 * step further. A payout that is done leaves the outbox; one that waits for
 * PayPal or for money comes back later; one that throws comes back after a
 * growing pause, and its lease keeps any other worker off it meanwhile.
 */
export async function runPayoutBatch(deps: PayoutDeps, log: InboxLog): Promise<number> {
  const messages = await claimOutbox(deps.db, PAYOUT_TOPIC, BATCH, LEASE_SECONDS);
  for (const message of messages) await handle(deps, log, message);
  return messages.length;
}

async function handle(deps: PayoutDeps, log: InboxLog, message: ClaimedMessage): Promise<void> {
  const executionId = executionOf(message.payload);
  if (executionId === null) {
    log({ level: "error", message: "payout.unreadable_message", messageId: message.id });
    await asService(deps.db, message.circleId, (tx) => finishMessage(tx, message.id));
    return;
  }
  try {
    const step = await executePayout(deps, message.circleId, executionId);
    log({ level: step.result === "failed" ? "error" : "info", message: `payout.${step.result}`, circleId: message.circleId, executionId });
    await asService(deps.db, message.circleId, (tx) => (step.next === "done" ? finishMessage(tx, message.id) : retryMessageLater(tx, message.id, step.seconds)));
  } catch (error) {
    const seconds = Math.min(MAX_BACKOFF_SECONDS, 30 * 2 ** Math.min(message.attempts, 7));
    log({ level: "error", message: "payout.retry", circleId: message.circleId, executionId, seconds, error: describe(error) });
    await asService(deps.db, message.circleId, (tx) => retryMessageLater(tx, message.id, seconds));
  }
}

function executionOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as Record<string, unknown>)["executionId"];
  return typeof id === "string" && UUID.test(id) ? id : null;
}

// Never a database error's message: it can quote the query's values (AGENTS.md section 6).
function describe(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { name: "unknown" };
  if (!(error instanceof PayPalError)) return { name: error.name };
  return { name: error.name, outcome: error.outcome, status: error.status, issue: error.issue, debugId: error.debugId };
}
