import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createPayPalClient, type Fetch } from "./client.ts";
import { PayPalError } from "./paypal-error.ts";
import { paypalPool } from "./pool.ts";
import { parseSubscription, subscriptionChangeRequestId, subscriptionMoveOutcome } from "./subscription.ts";

type Exchange = { readonly httpStatus: number; readonly body: unknown };
type Recording = {
  readonly suspend: { readonly request: { readonly path: string; readonly body: unknown }; readonly response: Exchange };
  readonly afterSuspend: Exchange;
  readonly activate: { readonly request: { readonly path: string; readonly body: unknown }; readonly response: Exchange };
  readonly afterActivate: Exchange;
  readonly activateCancelled: Exchange;
};

// Derived from PayPal's documentation, not recorded: see fixtures/README.md.
const recording = JSON.parse(readFileSync(new URL("./fixtures/subscription-suspend-documented-2026-11-10.json", import.meta.url), "utf8")) as Recording;
const ID = "I-BW452GLLEP1G";

/** PayPal as the documentation answers: a token, then each exchange in turn, keeping what Kin sent. */
function paypal(exchanges: Exchange[]) {
  const sent: { url: string; method: string; body: unknown; requestId: string | null }[] = [];
  const fetch: Fetch = async (url, init) => {
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token", expires_in: 32400 });
    const headers = new Headers(init.headers);
    sent.push({ url, method: init.method ?? "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null, requestId: headers.get("PayPal-Request-Id") });
    const next = exchanges.shift();
    if (next === undefined) throw new Error(`Unexpected call to ${url}`);
    return new Response(next.body === null ? null : JSON.stringify(next.body), { status: next.httpStatus });
  };
  const client = createPayPalClient({ apiUrl: "https://paypal.test", clientId: "id", clientSecret: "secret", fetch, now: () => new Date("2026-11-10T14:00:00Z"), sleep: async () => undefined, log: () => undefined });
  return { pool: paypalPool(client, "WH-ID"), sent };
}

describe("suspending and resuming a subscription her wishes name", () => {
  it("suspends with the reason and one request ID, and only PayPal's record read back says it is suspended", async () => {
    const { pool, sent } = paypal([recording.suspend.response, recording.afterSuspend]);
    const requestId = subscriptionChangeRequestId("9f1d2c3b-4a5e-4f60-8a7b-1c2d3e4f5a6b", "suspend", "6c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f");
    await pool.changeSubscription(ID, "suspend", "Rose's wishes: paused while she is in hospital", requestId);
    expect(sent[0]).toMatchObject({ url: `https://paypal.test${recording.suspend.request.path}`, method: "POST", body: recording.suspend.request.body, requestId });
    const read = await pool.getSubscription(ID);
    expect(read.status).toBe("SUSPENDED");
    expect(subscriptionMoveOutcome("suspend", read.status)).toBe("moved");
  });

  it("resumes when she is home, and reads it active again", async () => {
    const { pool, sent } = paypal([recording.activate.response, recording.afterActivate]);
    await pool.changeSubscription(ID, "activate", "Rose is home", "kin-sub-activate-row-message");
    expect(sent[0]).toMatchObject({ url: `https://paypal.test${recording.activate.request.path}`, body: recording.activate.request.body });
    const read = await pool.getSubscription(ID);
    expect(read.status).toBe("ACTIVE");
    expect(read.nextBillingAt?.toISOString()).toBe("2026-12-08T10:00:00.000Z");
    expect(subscriptionMoveOutcome("activate", read.status)).toBe("moved");
  });

  it("is told plainly when PayPal refuses, and never reads a refusal as done", async () => {
    const { pool } = paypal([recording.activateCancelled]);
    const refusal = await pool.changeSubscription(ID, "activate", "Rose is home", "req").catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(PayPalError);
    expect(refusal).toMatchObject({ outcome: "rejected", status: 422, issue: "SUBSCRIPTION_STATUS_INVALID" });
  });

  it("names what each status means for the move Kin asked", () => {
    const parsed = parseSubscription(recording.afterSuspend.body);
    expect(subscriptionMoveOutcome("activate", parsed.status)).toBe("not_moved");
    expect(subscriptionMoveOutcome("suspend", "ACTIVE")).toBe("not_moved");
    expect(subscriptionMoveOutcome("suspend", "CANCELLED")).toBe("gone");
    expect(subscriptionMoveOutcome("activate", "EXPIRED")).toBe("gone");
    expect(subscriptionChangeRequestId("row", "suspend", "message")).toBe("kin-sub-suspend-row-message");
  });
});
