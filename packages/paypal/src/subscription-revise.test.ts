import { describe, expect, it } from "vitest";

import { PayPalShapeError } from "./json.ts";
import { paypalPool } from "./pool.ts";
import { parsePlan, parseSubscriptionPlanId, parseSubscriptionRevised, reviseBody } from "./subscription.ts";
import { fakePool } from "./testing/index.ts";
import { readFixture, replayPool, type RecordedExchange } from "./testing/replay.ts";

// Recorded from the PayPal sandbox on 11 November 2026: see fixtures/README.md.
const recording = readFixture<{ revise: RecordedExchange[]; activateWhileRevisionPending: RecordedExchange[] }>("subscription-sandbox-2026-11-11.json");
const ID = "I-CUXNGCY1VJKR";
const RETURN = "https://kin.example.com/dashboard/shares";

describe("revising a monthly share's subscription to a new amount, as the sandbox answered", () => {
  it("makes a sibling plan for the amount on the circle's product, then moves the subscription onto it", async () => {
    const { pool, sent } = replayPool(recording.revise.slice(0, 4));
    const revised = await pool.reviseSubscription(ID, { cents: 200, currency: "USD" }, RETURN, "kin-quiet-revise-1");
    expect(revised.approvalUrl).toBe("https://www.sandbox.paypal.com/webapps/billing/subscriptions/update?ba_token=BA-5J3310331N293425F");
    expect(sent.map((each) => [each.method, each.path, each.requestId])).toEqual([
      ["GET", `/v1/billing/subscriptions/${ID}`, null],
      ["GET", "/v1/billing/plans/P-229450167E6731234NL2PKEA", null],
      ["POST", "/v1/billing/plans", `kin-plan-${ID}-USD-200`],
      // PayPal takes no request ID on revise.
      ["POST", `/v1/billing/subscriptions/${ID}/revise`, null],
    ]);
    // Exactly what the sandbox accepted.
    expect(sent[2]?.body).toEqual(recording.revise[2]?.request);
    expect(sent[3]?.body).toEqual(recording.revise[3]?.request);
  });

  it("sends the new plan, never a price override, which the sandbox refuses on the subscription's own plan", () => {
    expect(JSON.parse(reviseBody("P-5HL13463MH0673805NL2PKVA", RETURN))).toEqual(recording.revise[3]?.request);
    expect(parsePlan(recording.revise[1]?.body)).toEqual({ productId: "KIN-2e9f4001-652d-4466-8c6d-bd1884971119", name: "Kin sandbox check: monthly share" });
    expect(parseSubscriptionPlanId(recording.revise[0]?.body)).toBe("P-229450167E6731234NL2PKEA");
    expect(() => parseSubscriptionPlanId({ plan_id: "P-../../payouts" })).toThrow(PayPalShapeError);
  });

  it("reads the page where the payer approves the new price, and only a PayPal page over HTTPS", () => {
    expect(parseSubscriptionRevised(recording.revise[3]?.body)).toEqual({
      planOverridden: false,
      approvalUrl: "https://www.sandbox.paypal.com/webapps/billing/subscriptions/update?ba_token=BA-5J3310331N293425F",
    });
    expect(parseSubscriptionRevised({ plan_overridden: true, links: [] })).toEqual({ planOverridden: true, approvalUrl: null });
    expect(() => parseSubscriptionRevised({ links: [{ rel: "approve", href: "https://paypal.com.evil.example/x" }] })).toThrow(PayPalShapeError);
    expect(() => parseSubscriptionRevised("nope")).toThrow(PayPalShapeError);
  });

  it("leaves the old amount running until the payer approves: the subscription still reads its first plan", async () => {
    const { pool } = replayPool(recording.revise.slice(4));
    expect((await pool.getSubscription(ID)).status).toBe("ACTIVE");
    expect(parseSubscriptionPlanId(recording.revise[4]?.body)).toBe("P-229450167E6731234NL2PKEA");
  });

  it("is told plainly that a subscription with a revision waiting cannot be resumed until the payer answers it", async () => {
    const { pool } = replayPool(recording.activateWhileRevisionPending);
    await expect(pool.changeSubscription(ID, "activate", "Kin sandbox check", "resume")).rejects.toMatchObject({ outcome: "rejected", status: 422, issue: "SESSION_STATE_NOT_VALID" });
  });

  it("never puts anything but a subscription ID in a URL", async () => {
    const pool = paypalPool({ send: async () => ({}) }, "WH-ID");
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
