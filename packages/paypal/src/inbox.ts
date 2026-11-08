import { createHash } from "node:crypto";

import { UUID_PATTERN } from "./contribution-reference.ts";
import { parseWebhookEnvelope, WEBHOOK_HEADERS, type WebhookDelivery, type WebhookHeaders } from "./webhook.ts";
import { isPayPalId } from "./pool.ts";

/**
 * What the web app hands the worker through the PayPal inbox queue. The web
 * never applies money itself (it holds no service role): it passes on a
 * webhook exactly as received, or the news that it captured an order, and the
 * worker reads the truth back from PayPal.
 */
export type InboxMessage =
  | { readonly kind: "webhook"; readonly delivery: WebhookDelivery }
  | { readonly kind: "order_captured"; readonly circleId: string; readonly orderId: string }
  /** A member's monthly share (a row of Kin's own, by ID) may have changed at PayPal, or is a demo's: the worker reads it back and records what it charged. `requestId` keeps repeated asks apart. */
  | { readonly kind: "subscription_checked"; readonly circleId: string; readonly subscriptionId: string; readonly requestId: string }
  /** A request for money by invoice (a row of Kin's own, by ID) may have been paid or withdrawn, or is a demo's: the worker reads it back and records what was paid. */
  | { readonly kind: "invoice_checked"; readonly circleId: string; readonly invoiceRequestId: string; readonly requestId: string };

/** Messages for events Kin cannot place in a circle share this ordering group. */
export const UNPLACED_GROUP = "unplaced";

/** The FIFO group: one circle's messages are handled one at a time, in order. */
export function inboxGroup(message: InboxMessage): string {
  if (message.kind !== "webhook") return message.circleId;
  try {
    return parseWebhookEnvelope(message.delivery.body).reference?.circleId ?? UNPLACED_GROUP;
  } catch {
    return UNPLACED_GROUP;
  }
}

/**
 * The queue's deduplication ID. For a webhook it is a hash of the body:
 * PayPal redelivers an event with the same body, so repeats collapse, while a
 * forged body that merely borrows a genuine event's ID cannot make the queue
 * drop the real one. The worker refuses a second copy of a verified event by
 * its ID, for repeats the queue's five-minute window misses.
 */
export function inboxDeduplicationId(message: InboxMessage): string {
  if (message.kind === "order_captured") return `order-${message.orderId}`;
  if (message.kind === "subscription_checked") return `subscription-${message.requestId}`;
  if (message.kind === "invoice_checked") return `invoice-${message.requestId}`;
  return `webhook-${createHash("sha256").update(message.delivery.body).digest("hex")}`;
}

export function encodeInboxMessage(message: InboxMessage): string {
  return JSON.stringify(message);
}

const UUID = new RegExp(`^${UUID_PATTERN}$`);

/** Reads a message off the queue, or `null` when it is not one Kin wrote. */
export function parseInboxMessage(text: string): InboxMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record["kind"] === "order_captured") {
    const { circleId, orderId } = record;
    if (typeof circleId !== "string" || !UUID.test(circleId) || typeof orderId !== "string" || !isPayPalId(orderId)) return null;
    return { kind: "order_captured", circleId, orderId };
  }
  if (record["kind"] === "subscription_checked") {
    const { circleId, subscriptionId, requestId } = record;
    if (typeof circleId !== "string" || !UUID.test(circleId) || typeof subscriptionId !== "string" || !UUID.test(subscriptionId) || typeof requestId !== "string" || !UUID.test(requestId)) return null;
    return { kind: "subscription_checked", circleId, subscriptionId, requestId };
  }
  if (record["kind"] === "invoice_checked") {
    const { circleId, invoiceRequestId, requestId } = record;
    if (typeof circleId !== "string" || !UUID.test(circleId) || typeof invoiceRequestId !== "string" || !UUID.test(invoiceRequestId) || typeof requestId !== "string" || !UUID.test(requestId)) return null;
    return { kind: "invoice_checked", circleId, invoiceRequestId, requestId };
  }
  if (record["kind"] === "webhook") {
    const delivery = record["delivery"];
    if (typeof delivery !== "object" || delivery === null) return null;
    const { body, headers } = delivery as Record<string, unknown>;
    if (typeof body !== "string" || typeof headers !== "object" || headers === null) return null;
    const read = headers as Record<string, unknown>;
    if (!WEBHOOK_HEADERS.every((name) => typeof read[name] === "string")) return null;
    return { kind: "webhook", delivery: { body, headers: read as WebhookHeaders } };
  }
  return null;
}
