import { ContributionMismatchError, asService, settlePayPalEvent, storePayPalEvent, type Database } from "@kin/db";
import { parseWebhookEnvelope, type InboxMessage, type PayPalPool, type WebhookDelivery } from "@kin/paypal";

import { applyCapture, type CaptureOutcome } from "./apply-capture.ts";

export type InboxDeps = {
  /** Connected as `kin_service`. Every transaction names the one circle it acts for. */
  readonly db: Database;
  readonly pool: PayPalPool;
};

/**
 * What became of a message. Each is final: the message is removed from the
 * queue. A thrown error is not: the message returns and is tried again.
 */
export type InboxOutcome =
  | { readonly result: "unreadable" | "unplaced" | "duplicate" | "rejected" | "ignored" }
  | { readonly result: "applied"; readonly circleId: string; readonly captures: readonly CaptureOutcome[] }
  | { readonly result: "failed"; readonly circleId: string; readonly reason: string };

const FOREIGN_KEY_VIOLATION = "23503";

export async function handleInboxMessage(deps: InboxDeps, message: InboxMessage): Promise<InboxOutcome> {
  return message.kind === "webhook" ? handleWebhook(deps, message.delivery) : handleCapturedOrder(deps, message.circleId, message.orderId);
}

/**
 * A webhook delivery: stored raw first, verified with PayPal, and applied
 * from the resource read back from PayPal, never from the event's own body
 * (docs/architecture.md section 8.7).
 */
async function handleWebhook({ db, pool }: InboxDeps, delivery: WebhookDelivery): Promise<InboxOutcome> {
  let envelope;
  try {
    envelope = parseWebhookEnvelope(delivery.body);
  } catch {
    return { result: "unreadable" };
  }
  const circleId = envelope.reference?.circleId;
  if (circleId === undefined) return { result: "unplaced" };

  let stored;
  try {
    stored = await asService(db, circleId, (tx) =>
      storePayPalEvent(tx, { circleId, eventId: envelope.eventId, eventType: envelope.eventType, rawBody: delivery.body, headers: delivery.headers }),
    );
  } catch (error) {
    // The event names a circle Kin does not have.
    if (codeOf(error) === FOREIGN_KEY_VIOLATION) return { result: "unplaced" };
    throw error;
  }
  if (stored === null) return { result: "duplicate" };
  if (stored.state === "processed" || stored.state === "rejected" || stored.state === "failed") return { result: "duplicate" };

  if (!(await pool.verifyWebhook(delivery))) {
    await asService(db, circleId, (tx) => settlePayPalEvent(tx, stored.id, "rejected"));
    return { result: "rejected" };
  }
  await asService(db, circleId, (tx) => settlePayPalEvent(tx, stored.id, "verified"));

  if (envelope.eventType !== "PAYMENT.CAPTURE.COMPLETED" || envelope.captureId === null) {
    await asService(db, circleId, (tx) => settlePayPalEvent(tx, stored.id, "processed"));
    return { result: "ignored" };
  }
  const capture = await pool.getCapture(envelope.captureId);
  try {
    const outcome = await asService(db, circleId, async (tx) => {
      const applied = await applyCapture(tx, circleId, capture);
      await settlePayPalEvent(tx, stored.id, applied === "other_circle" ? "failed" : "processed");
      return applied;
    });
    return outcome === "other_circle" ? { result: "failed", circleId, reason: "other_circle" } : { result: "applied", circleId, captures: [outcome] };
  } catch (error) {
    return failed(db, circleId, stored.id, error);
  }
}

/**
 * The web app captured an order: the worker reads the order back from PayPal
 * and records each completed capture. Whichever of this and the webhook
 * comes first writes the entry; the other finds it there.
 */
async function handleCapturedOrder({ db, pool }: InboxDeps, circleId: string, orderId: string): Promise<InboxOutcome> {
  const order = await pool.getOrder(orderId);
  if (order.reference?.circleId !== circleId) return { result: "failed", circleId, reason: "other_circle" };
  try {
    const captures = await asService(db, circleId, async (tx) => {
      const outcomes: CaptureOutcome[] = [];
      for (const capture of order.captures) outcomes.push(await applyCapture(tx, circleId, capture));
      return outcomes;
    });
    return { result: "applied", circleId, captures };
  } catch (error) {
    if (!(error instanceof ContributionMismatchError)) throw error;
    return { result: "failed", circleId, reason: error.message };
  }
}

/** A verified event that cannot be applied is kept as failed for a person, not retried. */
async function failed(db: Database, circleId: string, eventId: string, error: unknown): Promise<InboxOutcome> {
  if (!(error instanceof ContributionMismatchError)) throw error;
  await asService(db, circleId, (tx) => settlePayPalEvent(tx, eventId, "failed"));
  return { result: "failed", circleId, reason: error.message };
}

function codeOf(error: unknown): string | undefined {
  // Drizzle wraps the driver's error; the SQLSTATE is on it or on its cause.
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const each of candidates) {
    const code = (each as { code?: unknown } | null)?.code;
    if (typeof code === "string") return code;
  }
  return undefined;
}
