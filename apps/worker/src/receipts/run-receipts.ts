import { RECEIPT_TOPIC, asService, claimOutbox, creditReceipt, finishMessage, retryMessageLater, type ClaimedMessage, type Database } from "@kin/db";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

export type ReceiptDeps = {
  /** Connected as `kin_service`. Every transaction names the one circle it acts for. */
  readonly db: Database;
  readonly now: () => Date;
};

const BATCH = 10;
const LEASE_SECONDS = 60;
/** A message that keeps failing is looked at less and less often, up to once an hour. */
const MAX_BACKOFF_SECONDS = 3_600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Leases the approved receipts waiting in the outbox and credits each to the
 * member who spent the money. A credit is keyed by its receipt, so a message
 * handed out twice, or retried after a crash, writes one ledger entry.
 */
export async function runReceiptBatch(deps: ReceiptDeps, log: InboxLog): Promise<number> {
  const messages = await claimOutbox(deps.db, RECEIPT_TOPIC, BATCH, LEASE_SECONDS);
  for (const message of messages) await handle(deps, log, message);
  return messages.length;
}

async function handle(deps: ReceiptDeps, log: InboxLog, message: ClaimedMessage): Promise<void> {
  const receiptId = receiptOf(message.payload);
  if (receiptId === null) {
    log({ level: "error", message: "receipt.unreadable_message", messageId: message.id });
    await asService(deps.db, message.circleId, (tx) => finishMessage(tx, message.id));
    return;
  }
  try {
    await asService(deps.db, message.circleId, async (tx) => {
      const outcome = await creditReceipt(tx, message.circleId, receiptId, deps.now());
      log({ level: "info", message: `receipt.${outcome}`, circleId: message.circleId, receiptId });
      await finishMessage(tx, message.id);
    });
  } catch (error) {
    const seconds = Math.min(MAX_BACKOFF_SECONDS, 30 * 2 ** Math.min(message.attempts, 7));
    // Never a database error's message: it can quote the query's values (AGENTS.md section 6).
    log({ level: "error", message: "receipt.retry", circleId: message.circleId, receiptId, seconds, error: error instanceof Error ? error.name : "unknown" });
    await asService(deps.db, message.circleId, (tx) => retryMessageLater(tx, message.id, seconds));
  }
}

function receiptOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as Record<string, unknown>)["receiptId"];
  return typeof id === "string" && UUID.test(id) ? id : null;
}
