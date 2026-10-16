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
  | { readonly kind: "order_captured"; readonly circleId: string; readonly orderId: string };

/** Messages for events Kin cannot place in a circle share this ordering group. */
export const UNPLACED_GROUP = "unplaced";

/** The FIFO group: one circle's messages are handled one at a time, in order. */
export function inboxGroup(message: InboxMessage): string {
  if (message.kind === "order_captured") return message.circleId;
  try {
    return parseWebhookEnvelope(message.delivery.body).reference?.circleId ?? UNPLACED_GROUP;
  } catch {
    return UNPLACED_GROUP;
  }
}

/**
 * The queue's deduplication ID. PayPal redelivers an event with the same ID;
 * the worker also refuses a second copy by that ID, for repeats the queue's
 * five-minute window misses.
 */
export function inboxDeduplicationId(message: InboxMessage): string {
  if (message.kind === "order_captured") return `order-${message.orderId}`;
  try {
    return `event-${parseWebhookEnvelope(message.delivery.body).eventId}`.slice(0, 128);
  } catch {
    return `transmission-${message.delivery.headers["paypal-transmission-id"]}`.slice(0, 128);
  }
}

export function encodeInboxMessage(message: InboxMessage): string {
  return JSON.stringify(message);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
