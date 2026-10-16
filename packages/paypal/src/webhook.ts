import { parseContributionReference, type ContributionReference } from "./contribution-reference.ts";
import { asRecord, optionalRecord, optionalText, parseJson, requiredText } from "./json.ts";

/** The transmission headers PayPal signs a webhook delivery with. */
export const WEBHOOK_HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"] as const;

export type WebhookHeaders = Readonly<Record<(typeof WEBHOOK_HEADERS)[number], string>>;

/** One delivery exactly as it arrived: the raw body and PayPal's headers. */
export type WebhookDelivery = { readonly body: string; readonly headers: WebhookHeaders };

/** The event types Kin subscribes the pool's webhook to. */
export const WEBHOOK_EVENT_TYPES = ["PAYMENT.CAPTURE.COMPLETED"] as const;

/**
 * What Kin reads from an event's envelope before it is verified: enough to
 * file it under a circle. Nothing here is trusted. Amounts and status are
 * always read back from PayPal after the signature checks out.
 */
export type WebhookEnvelope = {
  readonly eventId: string;
  readonly eventType: string;
  /** The capture the event is about, for capture events. */
  readonly captureId: string | null;
  readonly reference: ContributionReference | null;
};

export function parseWebhookEnvelope(body: string): WebhookEnvelope {
  const record = asRecord(parseJson(body, "webhook event"), "webhook event");
  const eventType = requiredText(record, "event_type");
  const resource = optionalRecord(record["resource"]);
  const isCapture = optionalText(record, "resource_type") === "capture";
  return {
    eventId: requiredText(record, "id"),
    eventType,
    captureId: isCapture ? optionalText(resource, "id") : null,
    reference: parseContributionReference(optionalText(resource, "custom_id")),
  };
}

/** PayPal's transmission headers from a request, or `null` when any is missing. */
export function webhookHeaders(read: (name: string) => string | null): WebhookHeaders | null {
  const entries = WEBHOOK_HEADERS.map((name) => [name, read(name)] as const);
  if (entries.some(([, value]) => value === null || value === "")) return null;
  return Object.fromEntries(entries) as WebhookHeaders;
}

/**
 * The body of PayPal's verify-webhook-signature call. The event is placed in
 * it byte for byte as received, never parsed and re-encoded, because the
 * signature covers the exact bytes PayPal sent.
 */
export function verificationBody(delivery: WebhookDelivery, webhookId: string): string {
  const { headers } = delivery;
  const fields = JSON.stringify({
    auth_algo: headers["paypal-auth-algo"],
    cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"],
    transmission_sig: headers["paypal-transmission-sig"],
    transmission_time: headers["paypal-transmission-time"],
    webhook_id: webhookId,
  });
  return `${fields.slice(0, -1)},"webhook_event":${delivery.body}}`;
}

export function parseVerification(value: unknown): boolean {
  return optionalText(asRecord(value, "verification"), "verification_status") === "SUCCESS";
}
