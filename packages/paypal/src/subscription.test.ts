import { describe, expect, it } from "vitest";

import { encodeInboxMessage, inboxDeduplicationId, inboxGroup, parseInboxMessage } from "./inbox.ts";
import { PayPalShapeError } from "./json.ts";
import { paypalPool } from "./pool.ts";
import type { PayPalRequest } from "./client.ts";
import { circleProductId, isSubscriptionId, parseSubscription, parseSubscriptionCreated, parseSubscriptionPayments, planBody, shareStateOf, subscriptionBody } from "./subscription.ts";
import { readFixture, replayPool, type RecordedExchange } from "./testing/replay.ts";
import { parseWebhookEnvelope } from "./webhook.ts";

const reference = { circleId: "0b6f4c3e-8d1a-4f6e-9c2b-5a7d3e1f9a40", memberId: "7c2e9a14-3b5d-4e8f-a1c6-d9b0f2e4a738" };
const row = "9f1d2c3b-4a5e-4f60-8a7b-1c2d3e4f5a6b";

describe("a monthly subscription's requests", () => {
  it("charges the exact amount every month with no end date, in the plan", () => {
    expect(JSON.parse(planBody("PROD-1", "Share", { cents: 15050, currency: "USD" }))).toMatchObject({
      product_id: "PROD-1",
      billing_cycles: [{ frequency: { interval_unit: "MONTH", interval_count: 1 }, tenure_type: "REGULAR", total_cycles: 0, pricing_scheme: { fixed_price: { value: "150.50", currency_code: "USD" } } }],
    });
  });

  it("names the circle and member on the subscription, with no shipping", () => {
    const body = JSON.parse(subscriptionBody("P-1", { amount: { cents: 5000, currency: "USD" }, reference, description: "Share", returnUrl: "https://kin.test/back" }));
    expect(body).toMatchObject({ plan_id: "P-1", custom_id: `kin1:${reference.circleId}:${reference.memberId}`, application_context: { shipping_preference: "NO_SHIPPING", return_url: "https://kin.test/back" } });
  });

  it("reads the approval page PayPal sent, and only if it is a PayPal page over HTTPS", () => {
    const created = (href: string) => ({ id: "I-BW452GLLEP1G", links: [{ rel: "self", href: "https://api.sandbox.paypal.com/x" }, { rel: "approve", href }] });
    expect(parseSubscriptionCreated(created("https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1"))).toEqual({
      subscriptionId: "I-BW452GLLEP1G",
      approvalUrl: "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1",
    });
    for (const href of ["https://evil.example/paypal.com", "http://www.paypal.com/x", "https://paypal.com.evil.example/x", "javascript:alert(1)"]) {
      expect(() => parseSubscriptionCreated(created(href))).toThrow(PayPalShapeError);
    }
  });

  it("keeps subscription IDs to PayPal's alphabet, since they go into URL paths", () => {
    expect(isSubscriptionId("I-BW452GLLEP1G")).toBe(true);
    for (const id of ["BW452GLLEP1G", "I-../orders", "I-bw452gllep1g", "I-"]) expect(isSubscriptionId(id)).toBe(false);
  });
});

describe("a subscription read back from PayPal", () => {
  it("says whose it is, where it stands and how its charges have gone", () => {
    expect(parseSubscription({ id: "I-BW452GLLEP1G", status: "ACTIVE", custom_id: `kin1:${reference.circleId}:${reference.memberId}`, subscriber: { payer_id: "QYR5Z8XDVJNXQ" }, billing_info: { next_billing_time: "2026-11-20T10:00:00Z", failed_payments_count: 1 } })).toEqual({
      id: "I-BW452GLLEP1G",
      status: "ACTIVE",
      reference,
      subscriberPayerId: "QYR5Z8XDVJNXQ",
      nextBillingAt: new Date("2026-11-20T10:00:00Z"),
      failedPayments: 1,
    });
    expect(parseSubscription({ id: "I-BW452GLLEP1G", status: "SOMETHING_NEW" })).toMatchObject({ status: "OTHER", reference: null, subscriberPayerId: null, nextBillingAt: null, failedPayments: 0 });
  });

  it("maps PayPal's status to a share's state, leaving an unknown one as it was", () => {
    expect(["APPROVAL_PENDING", "APPROVED", "ACTIVE", "SUSPENDED", "CANCELLED", "EXPIRED", "OTHER"].map((status) => shareStateOf(status as never))).toEqual([
      "approval_pending",
      "approval_pending",
      "active",
      "paused",
      "cancelled",
      "cancelled",
      null,
    ]);
  });

  it("lists only the charges that completed, in integer cents with PayPal's fee", () => {
    const listing = {
      transactions: [
        { id: "SALE1", status: "COMPLETED", time: "2026-10-20T15:00:00.000Z", amount_with_breakdown: { gross_amount: { currency_code: "USD", value: "150.00" }, fee_amount: { currency_code: "USD", value: "4.65" }, net_amount: { currency_code: "USD", value: "145.35" } } },
        { id: "SALE2", status: "FAILED", time: "2026-11-20T15:00:00.000Z", amount_with_breakdown: { gross_amount: { currency_code: "USD", value: "150.00" } } },
        { id: "SALE3", status: "PENDING", time: "2026-11-21T15:00:00.000Z", amount_with_breakdown: { gross_amount: { currency_code: "USD", value: "150.00" } } },
      ],
    };
    expect(parseSubscriptionPayments(listing)).toEqual([{ id: "SALE1", gross: { cents: 15000, currency: "USD" }, fee: { cents: 465, currency: "USD" }, paidAt: new Date("2026-10-20T15:00:00.000Z") }]);
    expect(parseSubscriptionPayments({})).toEqual([]);
  });
});

describe("the pool's subscription calls", () => {
  it("makes the circle's product under its own ID, the plan and the subscription, with request IDs", async () => {
    const sent: PayPalRequest[] = [];
    const pool = paypalPool(
      {
        send: async (request) => {
          sent.push(request);
          if (request.operation === "subscriptions.create") return { id: "I-BW452GLLEP1G", links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/approve" }] };
          return { id: request.operation === "products.create" ? `KIN-${reference.circleId}` : "P-1" };
        },
      },
      "WH-ID",
    );
    const made = await pool.createSubscription({ amount: { cents: 5000, currency: "USD" }, reference, description: "Share", returnUrl: "https://kin.test" }, row);
    expect(made).toEqual({ subscriptionId: "I-BW452GLLEP1G", approvalUrl: "https://www.sandbox.paypal.com/approve" });
    expect(sent.map((request) => [request.operation, request.requestId])).toEqual([
      ["products.create", `kin-product-${reference.circleId}`],
      ["plans.create", `kin-plan-${row}`],
      ["subscriptions.create", `kin-subscription-${row}`],
    ]);
  });

  describe("as the sandbox answered (recorded 11 November 2026)", () => {
    const { create } = readFixture<{ create: RecordedExchange[] }>("subscription-sandbox-2026-11-11.json");
    const circleId = "7e90af89-58bf-4e12-ad40-086a6edd46a9";
    const share = { amount: { cents: 100, currency: "USD" }, reference: { circleId, memberId: "005e9d08-e14d-4560-bff8-a56b663e2467" }, description: "Kin sandbox check: monthly share", returnUrl: "https://kin.example.com/dashboard/shares" };
    const key = "30bc5d7d-a265-45ca-baf2-0c45bdd08c34";

    it("makes the circle's product under Kin's own ID, a plan and a subscription waiting for the payer", async () => {
      const { pool, sent } = replayPool(create.slice(0, 3));
      expect(await pool.createSubscription(share, key)).toEqual({ subscriptionId: "I-7S1R5BN7FY5J", approvalUrl: "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-3D292887RW598515Y" });
      expect(sent.map((each) => each.body)).toEqual(create.slice(0, 3).map((each) => each.request));
      expect(sent[0]?.body).toMatchObject({ id: circleProductId(circleId) });
    });

    it("finds the circle's product by its own ID when PayPal already holds it, and makes no second plan for the same share", async () => {
      const { pool } = replayPool(create.slice(3, 6));
      // PayPal's sandbox did not honour the subscription's request ID: a repeat made a second, unapproved subscription.
      expect((await pool.createSubscription(share, key)).subscriptionId).toBe("I-1F6MUWG9GYRV");
      expect(create[3]).toMatchObject({ httpStatus: 422, body: { details: [{ issue: "DUPLICATE_RESOURCE_IDENTIFIER" }] } });
      expect(create[4]).toMatchObject({ httpStatus: 200, body: { id: "P-7X481161S62530903NL2PH7Q" } });
    });

    it("reads a subscription waiting for approval, which has no charges to list and cannot be suspended or resumed", async () => {
      const { pool } = replayPool(create.slice(9));
      expect(await pool.getSubscription("I-7S1R5BN7FY5J")).toMatchObject({ status: "APPROVAL_PENDING", reference: share.reference, subscriberPayerId: null, nextBillingAt: null });
      await expect(pool.listSubscriptionPayments("I-7S1R5BN7FY5J", new Date("2026-11-10T00:00:00Z"), new Date("2026-11-12T00:00:00Z"))).rejects.toMatchObject({ status: 404, issue: "INVALID_RESOURCE_ID" });
      await expect(pool.changeSubscription("I-7S1R5BN7FY5J", "suspend", "r", "q")).rejects.toMatchObject({ status: 404, issue: "INVALID_RESOURCE_ID" });
      await expect(pool.changeSubscription("I-7S1R5BN7FY5J", "activate", "r", "q")).rejects.toMatchObject({ status: 422, issue: "SESSION_STATE_NOT_VALID" });
    });
  });

  it("never puts anything but a subscription ID in a URL", async () => {
    const pool = paypalPool({ send: async () => ({}) }, "WH-ID");
    await expect(pool.getSubscription("I-../../v1/payments/payouts")).rejects.toThrow("Not a PayPal subscription ID");
    await expect(pool.changeSubscription("not-an-id", "cancel", "why", "req")).rejects.toThrow("Not a PayPal subscription ID");
  });
});

describe("subscription events and messages", () => {
  const sale = JSON.stringify({ id: "WH-9", event_type: "PAYMENT.SALE.COMPLETED", resource_type: "sale", resource: { id: "SALE1", billing_agreement_id: "I-BW452GLLEP1G" } });
  const activated = JSON.stringify({ id: "WH-8", event_type: "BILLING.SUBSCRIPTION.ACTIVATED", resource_type: "subscription", resource: { id: "I-BW452GLLEP1G", custom_id: `kin1:${reference.circleId}:${reference.memberId}` } });

  it("name the subscription whose charge or state they report; a sale names no circle", () => {
    expect(parseWebhookEnvelope(sale)).toEqual({ eventId: "WH-9", eventType: "PAYMENT.SALE.COMPLETED", captureId: null, refundId: null, subscriptionId: "I-BW452GLLEP1G", invoiceId: null, reference: null });
    expect(parseWebhookEnvelope(activated)).toMatchObject({ subscriptionId: "I-BW452GLLEP1G", reference });
  });

  it("ignore a subscription ID that is not PayPal's", () => {
    const forged = JSON.stringify({ id: "WH-7", event_type: "PAYMENT.SALE.COMPLETED", resource: { billing_agreement_id: "../orders" } });
    expect(parseWebhookEnvelope(forged).subscriptionId).toBeNull();
  });

  it("travel on the queue in the circle's own order, each ask apart from the last", () => {
    const message = { kind: "subscription_checked", circleId: reference.circleId, subscriptionId: row, requestId: reference.memberId } as const;
    expect(parseInboxMessage(encodeInboxMessage(message))).toEqual(message);
    expect(inboxGroup(message)).toBe(reference.circleId);
    expect(inboxDeduplicationId(message)).toBe(`subscription-${reference.memberId}`);
    expect(parseInboxMessage(JSON.stringify({ ...message, subscriptionId: "../x" }))).toBeNull();
  });
});
