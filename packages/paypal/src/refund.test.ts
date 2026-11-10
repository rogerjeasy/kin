import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseCapture } from "./capture.ts";
import { createPayPalClient, type Fetch } from "./client.ts";
import { PayPalShapeError } from "./json.ts";
import { paypalPool } from "./pool.ts";
import { parseRefund, refundedCaptureId } from "./refund.ts";
import { fakePool } from "./testing/fake-pool.ts";
import { REFUND_EVENTS, WEBHOOK_EVENT_TYPES, parseWebhookEnvelope } from "./webhook.ts";

// Derived from PayPal's documentation, not recorded: see fixtures/README.md.
type Recording = Record<"refundedEvent" | "reversedEvent" | "refundFeeKept" | "refundFeeReturned" | "refundPartial" | "captureRefunded" | "capturePartiallyRefunded", Record<string, unknown>>;
const recording = JSON.parse(readFileSync(new URL("./fixtures/refund-documented-2026-11-10.json", import.meta.url), "utf8")) as Recording;

const CAPTURE_ID = "3RG65204E9591424Y";
const usd = (cents: number) => ({ cents, currency: "USD" });

describe("a refund event", () => {
  it("is subscribed to, both for a refund the pool made and a reversal PayPal made", () => {
    expect(REFUND_EVENTS).toEqual(["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"]);
    expect(WEBHOOK_EVENT_TYPES).toEqual(expect.arrayContaining([...REFUND_EVENTS, "PAYMENT.CAPTURE.COMPLETED"]));
  });

  it("names the refund and the capture its up link points to, and no circle of its own", () => {
    expect(parseWebhookEnvelope(JSON.stringify(recording.refundedEvent))).toEqual({
      eventId: "WH-4KT83470P9813574D-1HE74537WC401473K",
      eventType: "PAYMENT.CAPTURE.REFUNDED",
      captureId: CAPTURE_ID,
      refundId: "6YB24758LT1462817",
      subscriptionId: null,
      invoiceId: null,
      reference: null,
    });
    expect(parseWebhookEnvelope(JSON.stringify(recording.reversedEvent))).toMatchObject({ eventType: "PAYMENT.CAPTURE.REVERSED", captureId: CAPTURE_ID, refundId: "8MC59130TF4471126" });
  });

  it("names no refund for any other event, and no capture when the up link is not a capture's", () => {
    const completed = JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource_type: "capture", resource: { id: CAPTURE_ID } });
    expect(parseWebhookEnvelope(completed)).toMatchObject({ captureId: CAPTURE_ID, refundId: null });

    const event = recording.refundedEvent;
    const resource = event["resource"] as Record<string, unknown>;
    const toOrder = { ...event, resource: { ...resource, links: [{ href: "https://api.sandbox.paypal.com/v2/checkout/orders/1SN482215K962041J", rel: "up", method: "GET" }] } };
    expect(parseWebhookEnvelope(JSON.stringify(toOrder))).toMatchObject({ refundId: "6YB24758LT1462817", captureId: null });
    const unlinked = { ...event, resource: { ...resource, links: undefined } };
    expect(parseWebhookEnvelope(JSON.stringify(unlinked))).toMatchObject({ captureId: null });
  });
});

describe("a refund read back from PayPal", () => {
  it("reads a full refund in which PayPal kept the whole fee, in integer cents", () => {
    expect(parseRefund(recording.refundFeeKept)).toEqual({
      id: "6YB24758LT1462817",
      status: "COMPLETED",
      captureId: CAPTURE_ID,
      gross: usd(10_000),
      feeReturned: usd(0),
      net: usd(10_000),
      totalRefunded: usd(10_000),
      createdAt: new Date("2026-11-10T09:12:40Z"),
    });
  });

  it("reads the part of the fee PayPal gave back, and a partial refund's running total", () => {
    expect(parseRefund(recording.refundFeeReturned)).toMatchObject({ gross: usd(10_000), feeReturned: usd(398), net: usd(9602), totalRefunded: usd(10_000) });
    expect(parseRefund(recording.refundPartial)).toMatchObject({ gross: usd(3000), feeReturned: usd(105), net: usd(2895), totalRefunded: usd(3000) });
  });

  it("takes a refund with no breakdown at its amount, with no fee returned and nothing more said", () => {
    const resource = recording.reversedEvent["resource"];
    expect(parseRefund(resource)).toMatchObject({ id: "8MC59130TF4471126", gross: usd(10_000), feeReturned: usd(0), net: null, totalRefunded: null, captureId: CAPTURE_ID });
  });

  it("refuses an amount it cannot read exactly, or amounts in two currencies", () => {
    const refund = recording.refundPartial;
    const breakdown = refund["seller_payable_breakdown"] as Record<string, unknown>;
    expect(() => parseRefund({ ...refund, seller_payable_breakdown: { ...breakdown, gross_amount: { currency_code: "USD", value: "30.005" } } })).toThrow(PayPalShapeError);
    expect(() => parseRefund({ ...refund, seller_payable_breakdown: { ...breakdown, paypal_fee: { currency_code: "EUR", value: "1.05" } } })).toThrow(PayPalShapeError);
    expect(() => parseRefund({ ...refund, status: undefined })).toThrow(PayPalShapeError);
  });

  it("calls a status it does not know OTHER, so it is never taken as completed", () => {
    expect(parseRefund({ ...recording.refundPartial, status: "REVERSED" }).status).toBe("OTHER");
  });

  it("follows only an up link to a capture", () => {
    expect(refundedCaptureId({ links: [{ rel: "up", href: "not a url" }] })).toBeNull();
    expect(refundedCaptureId({ links: [{ rel: "self", href: `https://api.sandbox.paypal.com/v2/payments/captures/${CAPTURE_ID}` }] })).toBeNull();
    expect(refundedCaptureId({ links: [{ rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/../../x" }] })).toBeNull();
  });
});

describe("a capture after a refund", () => {
  it("reads REFUNDED once nothing is left of it, and PARTIALLY_REFUNDED before", () => {
    expect(parseCapture(recording.captureRefunded)).toMatchObject({ id: CAPTURE_ID, status: "REFUNDED", gross: usd(10_000), fee: usd(398) });
    expect(parseCapture(recording.capturePartiallyRefunded)).toMatchObject({ id: CAPTURE_ID, status: "PARTIALLY_REFUNDED", gross: usd(10_000), fee: usd(398) });
  });
});

describe("the pool reading a refund", () => {
  it("asks for the refund by its ID with GET /v2/payments/refunds/{id}", async () => {
    const sent: string[] = [];
    const fetch: Fetch = async (url) => {
      if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token", expires_in: 32_400 });
      sent.push(url);
      return Response.json(recording.refundPartial);
    };
    const client = createPayPalClient({ apiUrl: "https://paypal.test", clientId: "id", clientSecret: "secret", fetch, now: () => new Date("2026-11-10T09:00:00Z"), sleep: async () => {}, log: () => {} });
    const refund = await paypalPool(client, "WH-ID").getRefund("1JU08902781691411");
    expect(sent).toEqual(["https://paypal.test/v2/payments/refunds/1JU08902781691411"]);
    expect(refund.gross).toEqual(usd(3000));
    await expect(paypalPool(client, "WH-ID").getRefund("../captures/x")).rejects.toThrow("Not a PayPal resource ID");
  });
});

describe("the fake pool's refunds", () => {
  async function captured(pool = fakePool()) {
    const { orderId } = await pool.createOrder({ amount: usd(2500), reference: { circleId: "c", memberId: "m" }, description: "Top-up", returnUrl: "https://kin.test" }, "create");
    pool.approve(orderId);
    const order = await pool.captureOrder(orderId, "capture");
    const capture = order.captures[0];
    if (capture === undefined) throw new Error("No capture");
    return { pool, capture };
  }

  it("turns the capture PARTIALLY_REFUNDED, then REFUNDED once nothing is left, and the event reads back to the refund", async () => {
    const { pool, capture } = await captured();
    const part = pool.refundCapture(capture.id, { cents: 1000 });
    expect((await pool.getCapture(capture.id)).status).toBe("PARTIALLY_REFUNDED");
    const rest = pool.refundCapture(capture.id, { feeReturnedCents: 52 });
    expect(rest).toMatchObject({ gross: usd(1500), feeReturned: usd(52), net: usd(1448), totalRefunded: usd(2500), captureId: capture.id });
    expect((await pool.getCapture(capture.id)).status).toBe("REFUNDED");
    expect(() => pool.refundCapture(capture.id)).toThrow();

    const envelope = parseWebhookEnvelope(pool.refundEvent(part.id, "PAYMENT.CAPTURE.REVERSED").body);
    expect(envelope).toMatchObject({ eventType: "PAYMENT.CAPTURE.REVERSED", refundId: part.id, captureId: capture.id });
    expect(await pool.getRefund(part.id)).toEqual(part);
  });

  it("leaves the capture as it was while a refund is pending", async () => {
    const { pool, capture } = await captured();
    pool.refundCapture(capture.id, { status: "PENDING" });
    expect((await pool.getCapture(capture.id)).status).toBe("COMPLETED");
  });
});
