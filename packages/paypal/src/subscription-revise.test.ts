import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { PayPalRequest } from "./client.ts";
import { PayPalShapeError } from "./json.ts";
import { paypalPool } from "./pool.ts";
import { parseSubscriptionRevised, reviseBody } from "./subscription.ts";
import { fakePool } from "./testing/index.ts";

/** Derived from PayPal's documentation of Subscriptions v1 revise, not recorded: see fixtures/README.md. */
const documented = JSON.parse(readFileSync(new URL("./fixtures/subscription-revise-documented-2026-11-10.json", import.meta.url), "utf8")) as { request: unknown; revised: unknown };

describe("revising a monthly share's subscription to a new amount", () => {
  it("prices the plan's one regular cycle again, exactly, and sends the payer back to Kin", () => {
    expect(JSON.parse(reviseBody({ cents: 39_000, currency: "USD" }, "https://kin.example/dashboard/fairness/quiet-shares"))).toEqual(documented.request);
  });

  it("reads the page where the payer approves the new price, and only a PayPal page over HTTPS", () => {
    expect(parseSubscriptionRevised(documented.revised)).toEqual({
      planOverridden: true,
      approvalUrl: "https://www.sandbox.paypal.com/webapps/billing/subscriptions/update?ba_token=BA-2M539689T3856352J",
    });
    expect(parseSubscriptionRevised({ plan_overridden: true, links: [] })).toEqual({ planOverridden: true, approvalUrl: null });
    expect(() => parseSubscriptionRevised({ links: [{ rel: "approve", href: "https://paypal.com.evil.example/x" }] })).toThrow(PayPalShapeError);
    expect(() => parseSubscriptionRevised("nope")).toThrow(PayPalShapeError);
  });

  it("posts to the subscription's own revise path with the request ID, and never puts anything but a subscription ID in it", async () => {
    const sent: PayPalRequest[] = [];
    const pool = paypalPool({ send: async (request) => (sent.push(request), documented.revised) }, "WH-ID");
    const revised = await pool.reviseSubscription("I-BW452GLLEP1G", { cents: 39_000, currency: "USD" }, "https://kin.example/back", "kin-quiet-revise-1");
    expect(revised.approvalUrl).toContain("ba_token=BA-2M539689T3856352J");
    expect(sent.map((request) => [request.method, request.path, request.requestId, request.operation])).toEqual([["POST", "/v1/billing/subscriptions/I-BW452GLLEP1G/revise", "kin-quiet-revise-1", "subscriptions.revise"]]);
    await expect(pool.reviseSubscription("I-../../payouts", { cents: 1, currency: "USD" }, "https://kin.example", "x")).rejects.toThrow("Not a PayPal subscription ID");
  });

  it("is kept by the fake pool: only a live subscription is revised, and a repeated request revises nothing new", async () => {
    const pool = fakePool();
    const made = await pool.createSubscription({ amount: { cents: 30_000, currency: "USD" }, reference: { circleId: "0b6f4c3e-8d1a-4f6e-9c2b-5a7d3e1f9a40", memberId: "7c2e9a14-3b5d-4e8f-a1c6-d9b0f2e4a738" }, description: "Share", returnUrl: "https://kin.example" }, "row-1");
    await expect(pool.reviseSubscription(made.subscriptionId, { cents: 39_000, currency: "USD" }, "https://kin.example", "r-1")).rejects.toThrow();
    pool.approveSubscription(made.subscriptionId);
    await pool.reviseSubscription(made.subscriptionId, { cents: 39_000, currency: "USD" }, "https://kin.example", "r-2");
    await pool.reviseSubscription(made.subscriptionId, { cents: 39_000, currency: "USD" }, "https://kin.example", "r-2");
    expect(pool.subscriptions.get(made.subscriptionId)?.revisions).toEqual([{ cents: 39_000, currency: "USD" }]);
  });
});
