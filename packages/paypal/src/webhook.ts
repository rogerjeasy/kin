import { parseContributionReference, type ContributionReference } from "./contribution-reference.ts";
import { isInvoiceId } from "./invoice.ts";
import { refundedCaptureId } from "./refund.ts";
import { isSubscriptionId } from "./subscription.ts";
import { asRecord, optionalRecord, optionalText, parseJson, requiredText } from "./json.ts";

/** The transmission headers PayPal signs a webhook delivery with. */
export const WEBHOOK_HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"] as const;

export type WebhookHeaders = Readonly<Record<(typeof WEBHOOK_HEADERS)[number], string>>;

/** One delivery exactly as it arrived: the raw body and PayPal's headers. */
export type WebhookDelivery = { readonly body: string; readonly headers: WebhookHeaders };

/** PayPal's event for money that has arrived: the one Kin records. */
export const CAPTURE_COMPLETED = "PAYMENT.CAPTURE.COMPLETED";

/**
 * PayPal's events for money that went back from a capture to its payer: a
 * refund the pool's owner made, or a reversal PayPal made itself. The resource
 * is the refund, which links the capture it returns.
 */
export const REFUND_EVENTS = ["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"] as const;

/** PayPal's events about a monthly subscription: its state changes and its charges. */
export const SUBSCRIPTION_EVENTS = [
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
  "PAYMENT.SALE.COMPLETED",
] as const;

/** PayPal's events about an invoice Kin sent a member: paid, or withdrawn. */
export const INVOICE_EVENTS = ["INVOICING.INVOICE.PAID", "INVOICING.INVOICE.CANCELLED"] as const;

/** The event types Kin subscribes the pool's webhook to. */
export const WEBHOOK_EVENT_TYPES = [CAPTURE_COMPLETED, ...REFUND_EVENTS, ...SUBSCRIPTION_EVENTS, ...INVOICE_EVENTS] as const;

/**
 * What Kin reads from an event's envelope before it is verified: enough to
 * file it under a circle. Nothing here is trusted. Amounts and status are
 * always read back from PayPal after the signature checks out.
 */
export type WebhookEnvelope = {
  readonly eventId: string;
  readonly eventType: string;
  /** The capture the event is about: a capture event's own resource, or the capture a refund event's resource links. */
  readonly captureId: string | null;
  /** The refund a refund or reversal event is about. */
  readonly refundId: string | null;
  /** The subscription a subscription event is about, or whose charge a sale event reports. */
  readonly subscriptionId: string | null;
  /** The invoice an invoicing event is about, or the one a capture paid. Whose it is, PayPal says when it is read back. */
  readonly invoiceId: string | null;
  readonly reference: ContributionReference | null;
};

export function parseWebhookEnvelope(body: string): WebhookEnvelope {
  const record = asRecord(parseJson(body, "webhook event"), "webhook event");
  const eventType = requiredText(record, "event_type");
  const resource = optionalRecord(record["resource"]);
  const isCapture = optionalText(record, "resource_type") === "capture";
  // Known by its event type, not its resource type: PayPal's documentation shows no reversal's payload.
  const isRefund = (REFUND_EVENTS as readonly string[]).includes(eventType);
  const subscriptionId =
    eventType === "PAYMENT.SALE.COMPLETED" ? optionalText(resource, "billing_agreement_id") : eventType.startsWith("BILLING.SUBSCRIPTION.") ? optionalText(resource, "id") : null;
  // PayPal's simulator sends the invoice as the resource itself; Invoicing v2 deliveries wrap it in `invoice`.
  // A capture that paid an invoice names it too (seen on the capture read back in the sandbox, 8 November 2026).
  const invoiceId = eventType.startsWith("INVOICING.INVOICE.")
    ? (optionalText(optionalRecord(resource?.["invoice"]), "id") ?? optionalText(resource, "id"))
    : isCapture
      ? optionalText(resource, "invoice_id")
      : null;
  return {
    eventId: requiredText(record, "id"),
    eventType,
    captureId: isCapture ? optionalText(resource, "id") : isRefund ? refundedCaptureId(resource) : null,
    refundId: isRefund ? optionalText(resource, "id") : null,
    subscriptionId: subscriptionId !== null && isSubscriptionId(subscriptionId) ? subscriptionId : null,
    invoiceId: invoiceId !== null && isInvoiceId(invoiceId) ? invoiceId : null,
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
