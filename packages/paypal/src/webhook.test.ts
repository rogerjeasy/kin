import { describe, expect, it } from "vitest";

import { encodeContributionReference, parseContributionReference } from "./contribution-reference.ts";
import { encodeInboxMessage, inboxDeduplicationId, inboxGroup, parseInboxMessage, UNPLACED_GROUP } from "./inbox.ts";
import { paypalPool } from "./pool.ts";
import { PayPalError } from "./paypal-error.ts";
import { parseWebhookEnvelope, verificationBody, webhookHeaders, type WebhookDelivery } from "./webhook.ts";

const reference = { circleId: "0b6f4c3e-8d1a-4f6e-9c2b-5a7d3e1f9a40", memberId: "7c2e9a14-3b5d-4e8f-a1c6-d9b0f2e4a738" };
// Spacing and key order as PayPal sent them: the signature covers these exact bytes.
const body = `{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource_type":"capture",  "resource":{"id":"CAP1","custom_id":"${encodeContributionReference(reference)}","amount":{"value":"25.00"}}}`;
const headers = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-transmission-id": "T-1",
  "paypal-transmission-sig": "c2ln",
  "paypal-transmission-time": "2026-10-16T08:00:00Z",
};
const delivery: WebhookDelivery = { body, headers };

describe("a webhook delivery", () => {
  it("is filed under the circle its capture names, before anything about it is trusted", () => {
    expect(parseWebhookEnvelope(body)).toEqual({ eventId: "WH-1", eventType: "PAYMENT.CAPTURE.COMPLETED", captureId: "CAP1", refundId: null, subscriptionId: null, invoiceId: null, reference });
  });

  it("is checked with PayPal byte for byte as it arrived, never re-encoded", () => {
    const sent = verificationBody(delivery, "WH-ID");
    expect(sent.endsWith(`"webhook_event":${body}}`)).toBe(true);
    expect(JSON.parse(sent)).toMatchObject({ webhook_id: "WH-ID", transmission_id: "T-1", auth_algo: "SHA256withRSA" });
  });

  it("needs every one of PayPal's transmission headers", () => {
    expect(webhookHeaders((name) => headers[name as keyof typeof headers] ?? null)).toEqual(headers);
    expect(webhookHeaders((name) => (name === "paypal-transmission-sig" ? null : (headers[name as keyof typeof headers] ?? null)))).toBeNull();
  });

  it("counts PayPal's refusal to check it as unverified, but an outage as an error to retry", async () => {
    const refusing = paypalPool({ send: async () => Promise.reject(new PayPalError({ outcome: "rejected", status: 400, issue: "VALIDATION_ERROR", debugId: null, operation: "webhooks.verify" })) }, "WH-ID");
    expect(await refusing.verifyWebhook(delivery)).toBe(false);
    const down = paypalPool({ send: async () => Promise.reject(new PayPalError({ outcome: "unavailable", status: 503, issue: null, debugId: null, operation: "webhooks.verify" })) }, "WH-ID");
    await expect(down.verifyWebhook(delivery)).rejects.toMatchObject({ outcome: "unavailable" });
    const vouching = paypalPool({ send: async () => ({ verification_status: "SUCCESS" }) }, "WH-ID");
    expect(await vouching.verifyWebhook(delivery)).toBe(true);
    const doubting = paypalPool({ send: async () => ({ verification_status: "FAILURE" }) }, "WH-ID");
    expect(await doubting.verifyWebhook(delivery)).toBe(false);
  });
});

describe("the contribution reference", () => {
  it("round-trips a circle and a member, and ignores anything that is not Kin's", () => {
    expect(parseContributionReference(encodeContributionReference(reference))).toEqual(reference);
    for (const other of [null, "", "invoice-77", `kin2:${reference.circleId}:${reference.memberId}`, `kin1:${reference.circleId}`, `kin1:${reference.circleId}:${reference.memberId}:x`]) {
      expect(parseContributionReference(other)).toBeNull();
    }
    expect(() => encodeContributionReference({ circleId: "not-a-uuid", memberId: reference.memberId })).toThrow();
  });
});

describe("the inbox message", () => {
  it("round-trips both kinds, and refuses anything Kin did not write", () => {
    const captured = { kind: "order_captured", circleId: reference.circleId, orderId: "5T37836141355693B" } as const;
    expect(parseInboxMessage(encodeInboxMessage(captured))).toEqual(captured);
    expect(parseInboxMessage(encodeInboxMessage({ kind: "webhook", delivery }))).toEqual({ kind: "webhook", delivery });
    expect(parseInboxMessage("not json")).toBeNull();
    expect(parseInboxMessage(JSON.stringify({ ...captured, orderId: "../../admin" }))).toBeNull();
    expect(parseInboxMessage(JSON.stringify({ kind: "webhook", delivery: { body, headers: { ...headers, "paypal-transmission-sig": 1 } } }))).toBeNull();
  });

  it("keeps one circle's messages in one ordered group, deduplicated by PayPal's event ID", () => {
    expect(inboxGroup({ kind: "webhook", delivery })).toBe(reference.circleId);
    expect(inboxGroup({ kind: "order_captured", circleId: reference.circleId, orderId: "ORDER1" })).toBe(reference.circleId);
    expect(inboxGroup({ kind: "webhook", delivery: { body: "{}", headers } })).toBe(UNPLACED_GROUP);
    // PayPal's redelivery has the same body under new transmission headers: one copy.
    const redelivered = { body, headers: { ...headers, "paypal-transmission-id": "T-2", "paypal-transmission-sig": "b3RoZXI=" } };
    expect(inboxDeduplicationId({ kind: "webhook", delivery: redelivered })).toBe(inboxDeduplicationId({ kind: "webhook", delivery }));
    // A forged body that borrows the genuine event's ID cannot make the queue drop the real one.
    const forged = { body: body.replace("25.00", "1.00"), headers };
    expect(inboxDeduplicationId({ kind: "webhook", delivery: forged })).not.toBe(inboxDeduplicationId({ kind: "webhook", delivery }));
    expect(inboxDeduplicationId({ kind: "webhook", delivery })).toMatch(/^webhook-[0-9a-f]{64}$/);
    expect(inboxDeduplicationId({ kind: "order_captured", circleId: reference.circleId, orderId: "ORDER1" })).toBe("order-ORDER1");
  });
});
