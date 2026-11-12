import { describe, expect, it } from "vitest";

import { PayPalError } from "./paypal-error.ts";
import { parseSubscription, subscriptionChangeRequestId, subscriptionMoveOutcome } from "./subscription.ts";
import { readFixture, replayPool, type RecordedExchange } from "./testing/replay.ts";

// Recorded from the PayPal sandbox on 11 November 2026: see fixtures/README.md.
const recording = readFixture<{ lifecycle: RecordedExchange[] }>("subscription-sandbox-2026-11-11.json");
const [read, payments, suspend, afterSuspend, suspendAgain, stillSuspended, activate, afterActivate, activateAgain, stillActive, cancel, afterCancel, activateCancelled, stillCancelled] = recording.lifecycle as [RecordedExchange, ...RecordedExchange[]];
const ID = "I-CSP0NHWX4BFG";

describe("suspending and resuming a subscription her wishes name, as the sandbox answered", () => {
  it("reads an approved subscription active, with its payer, its next charge and the dollar it took", async () => {
    const { pool } = replayPool([read, payments].filter((each) => each !== undefined));
    expect(await pool.getSubscription(ID)).toMatchObject({ status: "ACTIVE", subscriberPayerId: "PLACEHOLDER", nextBillingAt: new Date("2026-12-11T10:00:00Z"), failedPayments: 0 });
    expect(await pool.listSubscriptionPayments(ID, new Date("2026-11-10T00:00:00Z"), new Date("2026-11-12T00:00:00Z"))).toEqual([
      { id: "28129717MV883724F", gross: { cents: 100, currency: "USD" }, fee: { cents: 52, currency: "USD" }, paidAt: new Date("2026-11-11T22:58:34.000Z") },
    ]);
  });

  it("suspends with the reason and no request ID, which PayPal does not take there, and only the record read back says it moved", async () => {
    const { pool, sent } = replayPool([suspend, afterSuspend].filter((each) => each !== undefined));
    const requestId = subscriptionChangeRequestId("9f1d2c3b-4a5e-4f60-8a7b-1c2d3e4f5a6b", "suspend", "6c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f");
    await pool.changeSubscription(ID, "suspend", "Kin sandbox check", requestId);
    expect(sent[0]).toEqual({ method: "POST", path: `/v1/billing/subscriptions/${ID}/suspend`, requestId: null, body: { reason: "Kin sandbox check" } });
    const status = (await pool.getSubscription(ID)).status;
    expect(status).toBe("SUSPENDED");
    expect(subscriptionMoveOutcome("suspend", status)).toBe("moved");
  });

  it("is refused, not recognised, when asked twice: the record read back still says where it stands", async () => {
    const { pool } = replayPool([suspendAgain, stillSuspended].filter((each) => each !== undefined));
    const refusal = await pool.changeSubscription(ID, "suspend", "Kin sandbox check", "repeat").catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(PayPalError);
    expect(refusal).toMatchObject({ outcome: "rejected", status: 422, issue: "SUBSCRIPTION_STATUS_INVALID" });
    expect(subscriptionMoveOutcome("suspend", (await pool.getSubscription(ID)).status)).toBe("moved");
  });

  it("resumes, and reads it active again with its next charge", async () => {
    const { pool, sent } = replayPool([activate, afterActivate, activateAgain, stillActive].filter((each) => each !== undefined));
    await pool.changeSubscription(ID, "activate", "Kin sandbox check", "resume");
    expect(sent[0]).toMatchObject({ path: `/v1/billing/subscriptions/${ID}/activate`, requestId: null });
    const resumed = await pool.getSubscription(ID);
    expect(resumed).toMatchObject({ status: "ACTIVE", nextBillingAt: new Date("2026-12-11T10:00:00Z") });
    expect(subscriptionMoveOutcome("activate", resumed.status)).toBe("moved");
    await expect(pool.changeSubscription(ID, "activate", "Kin sandbox check", "resume-again")).rejects.toMatchObject({ status: 422, issue: "SUBSCRIPTION_STATUS_INVALID" });
  });

  it("ends it, and a cancelled subscription can never be resumed", async () => {
    const { pool } = replayPool([cancel, afterCancel, activateCancelled, stillCancelled].filter((each) => each !== undefined));
    await pool.changeSubscription(ID, "cancel", "Kin sandbox check", "end");
    expect((await pool.getSubscription(ID)).status).toBe("CANCELLED");
    await expect(pool.changeSubscription(ID, "activate", "Kin sandbox check", "resume")).rejects.toMatchObject({ outcome: "rejected", status: 422, issue: "SUBSCRIPTION_STATUS_INVALID" });
    expect(subscriptionMoveOutcome("activate", (await pool.getSubscription(ID)).status)).toBe("gone");
  });

  it("names what each status means for the move Kin asked", () => {
    const parsed = parseSubscription(afterSuspend?.body);
    expect(subscriptionMoveOutcome("activate", parsed.status)).toBe("not_moved");
    expect(subscriptionMoveOutcome("suspend", "ACTIVE")).toBe("not_moved");
    expect(subscriptionMoveOutcome("suspend", "CANCELLED")).toBe("gone");
    expect(subscriptionMoveOutcome("activate", "EXPIRED")).toBe("gone");
    expect(subscriptionChangeRequestId("row", "suspend", "message")).toBe("kin-sub-suspend-row-message");
  });
});
