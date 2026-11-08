import { ContributionMismatchError, asService, settlePayPalEvent, storePayPalEvent, type Database } from "@kin/db";
import { CAPTURE_COMPLETED, INVOICE_EVENTS, PayPalError, SUBSCRIPTION_EVENTS, captureRequestId, parseWebhookEnvelope, type InboxMessage, type PayPalPool, type WebhookDelivery } from "@kin/paypal";

import { applyCapture, type CaptureOutcome } from "./apply-capture.ts";
import { syncInvoice, type InvoiceOutcome } from "./apply-invoice.ts";
import { syncShare, type ShareOutcome } from "./apply-share.ts";

export type InboxDeps = {
  /** Connected as `kin_service`. Every transaction names the one circle it acts for. */
  readonly db: Database;
  readonly pool: PayPalPool;
  /** The clock, for the window of charges a monthly share is read back over. */
  readonly now?: () => Date;
};

/**
 * What became of a message. Each is final: the message is removed from the
 * queue. A thrown error is not: the message returns and is tried again.
 */
export type InboxOutcome =
  | { readonly result: "unreadable" | "unplaced" | "duplicate" | "ignored" }
  /** PayPal did not vouch for it. Logged with its IDs for inspection, and stored nowhere. */
  | { readonly result: "rejected"; readonly eventId: string; readonly transmissionId: string }
  | { readonly result: "applied"; readonly circleId: string; readonly captures: readonly CaptureOutcome[] }
  | { readonly result: "failed"; readonly circleId: string; readonly reason: string }
  | ShareOutcome
  | InvoiceOutcome;

const FOREIGN_KEY_VIOLATION = "23503";

export async function handleInboxMessage(deps: InboxDeps, message: InboxMessage): Promise<InboxOutcome> {
  if (message.kind === "webhook") return handleWebhook(deps, message.delivery);
  if (message.kind === "subscription_checked") return syncShare(deps, message.circleId, { id: message.subscriptionId }, (deps.now ?? (() => new Date()))());
  if (message.kind === "invoice_checked") return checkedInvoice(deps, message.circleId, message.invoiceRequestId);
  return handleCapturedOrder(deps, message.circleId, message.orderId);
}

/**
 * A webhook delivery: verified with PayPal first, then stored raw, then
 * applied from the resource read back from PayPal, never from the event's own
 * body (docs/architecture.md section 8.7). Nothing from an unverified body is
 * written anywhere, so a forged delivery cannot file an event ID under a
 * circle and make the genuine event look like a repeat. The delivery was
 * already held durably by the queue before PayPal heard 200.
 */
async function handleWebhook(deps: InboxDeps, delivery: WebhookDelivery): Promise<InboxOutcome> {
  const { db, pool } = deps;
  let envelope;
  try {
    envelope = parseWebhookEnvelope(delivery.body);
  } catch {
    return { result: "unreadable" };
  }
  if (!(await pool.verifyWebhook(delivery))) {
    return { result: "rejected", eventId: envelope.eventId, transmissionId: delivery.headers["paypal-transmission-id"] };
  }
  // PayPal signed the body, so the circle it names is the one Kin's server
  // put on the order. The capture is still read back before any money moves.
  // A subscription's charge names only the subscription, and an invoice event
  // only the invoice; PayPal says whose it is when it is read back.
  const circleId = envelope.reference?.circleId ?? (await placeByPayPal(pool, envelope));
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

  await asService(db, circleId, (tx) => settlePayPalEvent(tx, stored.id, "verified"));

  if (envelope.subscriptionId !== null && (SUBSCRIPTION_EVENTS as readonly string[]).includes(envelope.eventType)) {
    return settleShareEvent(deps, circleId, stored.id, envelope.subscriptionId);
  }
  // An invoice's own event, or the capture that paid one: either way the invoice is read back and its payment credited once.
  const aboutInvoice = (INVOICE_EVENTS as readonly string[]).includes(envelope.eventType) || (envelope.eventType === CAPTURE_COMPLETED && envelope.reference === null);
  if (envelope.invoiceId !== null && aboutInvoice) {
    return settleInvoiceEvent(deps, circleId, stored.id, envelope.invoiceId);
  }
  if (envelope.eventType !== CAPTURE_COMPLETED || envelope.captureId === null) {
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

/** A verified subscription event: the share is read back from PayPal, never taken from the event's own body. */
async function settleShareEvent(deps: InboxDeps, circleId: string, eventId: string, subscriptionId: string): Promise<InboxOutcome> {
  try {
    const outcome = await syncShare(deps, circleId, { paypalSubscriptionId: subscriptionId }, (deps.now ?? (() => new Date()))());
    await asService(deps.db, circleId, (tx) => settlePayPalEvent(tx, eventId, outcome.result === "failed" ? "failed" : "processed"));
    return outcome;
  } catch (error) {
    return failed(deps.db, circleId, eventId, error);
  }
}

/** The circle a verified event belongs to, by asking PayPal about the subscription or invoice it names. */
async function placeByPayPal(pool: PayPalPool, envelope: { readonly subscriptionId: string | null; readonly invoiceId: string | null }): Promise<string | undefined> {
  if (envelope.subscriptionId !== null) return (await pool.getSubscription(envelope.subscriptionId)).reference?.circleId;
  if (envelope.invoiceId === null) return undefined;
  try {
    return (await pool.getInvoice(envelope.invoiceId)).reference?.circleId;
  } catch (error) {
    // An invoice PayPal will not show the pool is no invoice of Kin's. Only an outage is retried.
    if (error instanceof PayPalError && error.outcome === "rejected") return undefined;
    throw error;
  }
}

/** A verified invoicing event: the invoice and its payment are read back from PayPal, never taken from the event's own body. */
async function settleInvoiceEvent(deps: InboxDeps, circleId: string, eventId: string, invoiceId: string): Promise<InboxOutcome> {
  try {
    const outcome = await syncInvoice(deps, circleId, { paypalInvoiceId: invoiceId });
    await asService(deps.db, circleId, (tx) => settlePayPalEvent(tx, eventId, outcome.result === "failed" ? "failed" : "processed"));
    return outcome;
  } catch (error) {
    return failed(deps.db, circleId, eventId, error);
  }
}

/** The web app asked for a request to be read back: it was just sent, or someone asked whether it is paid. */
async function checkedInvoice(deps: InboxDeps, circleId: string, requestId: string): Promise<InboxOutcome> {
  try {
    return await syncInvoice(deps, circleId, { id: requestId });
  } catch (error) {
    if (!(error instanceof ContributionMismatchError)) throw error;
    return { result: "failed", circleId, reason: error.message };
  }
}

/**
 * The web app captured an order, or tried to and could not tell whether it
 * worked. The worker reads the order back from PayPal and records each
 * completed capture; whichever of this and the webhook comes first writes the
 * entry, and the other finds it there. An order still `APPROVED` was never
 * captured: the payer said yes and the web app's capture did not reach
 * PayPal, so the worker finishes it with the same request ID, which PayPal
 * honours at most once. If PayPal cannot be reached, this throws and the
 * message is tried again: uncertain means ask again, never assume.
 */
async function handleCapturedOrder({ db, pool }: InboxDeps, circleId: string, orderId: string): Promise<InboxOutcome> {
  const read = await pool.getOrder(orderId);
  if (read.reference?.circleId !== circleId) return { result: "failed", circleId, reason: "other_circle" };
  const order = read.status === "APPROVED" ? await pool.captureOrder(orderId, captureRequestId(orderId)) : read;
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
