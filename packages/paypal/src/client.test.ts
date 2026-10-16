import { describe, expect, it } from "vitest";

import { createPayPalClient, type Fetch, type PayPalCallLog } from "./client.ts";
import { PayPalError } from "./paypal-error.ts";

type Reply = { status: number; body?: unknown; raw?: string; debugId?: string } | "network" | "body-timeout";

/** A PayPal stand-in that answers the token call, then the scripted replies in order. */
function scripted(replies: Reply[], options: { tokenSeconds?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  let tokens = 0;
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) {
      tokens += 1;
      return Response.json({ access_token: `token-${tokens}`, expires_in: options.tokenSeconds ?? 32400 });
    }
    const reply = replies.shift();
    if (reply === undefined) throw new Error(`Unexpected call to ${url}`);
    if (reply === "network") throw new TypeError("fetch failed");
    if (reply === "body-timeout") {
      // The headers arrive; the body stalls until the timeout aborts it.
      const response = new Response("{}", { status: 201 });
      Object.defineProperty(response, "text", { value: () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")) });
      return response;
    }
    const body = reply.raw ?? (reply.body === undefined ? "" : JSON.stringify(reply.body));
    return new Response(body, { status: reply.status, headers: reply.debugId ? { "paypal-debug-id": reply.debugId } : {} });
  };
  return { fetch, calls, tokenCalls: () => tokens };
}

function client(fetch: Fetch, now = () => new Date("2026-10-16T08:00:00Z")) {
  const logs: PayPalCallLog[] = [];
  const sleeps: number[] = [];
  const instance = createPayPalClient({
    apiUrl: "https://paypal.test",
    clientId: "id",
    clientSecret: "secret",
    fetch,
    now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: (call) => logs.push(call),
  });
  return { instance, logs, sleeps };
}

const get = { method: "GET", path: "/v2/checkout/orders/ABC12", operation: "orders.get" } as const;

describe("the PayPal client", () => {
  it("signs in once and reuses the token until shortly before it expires", async () => {
    let now = new Date("2026-10-16T08:00:00Z");
    const paypal = scripted([{ status: 200, body: { id: "1" } }, { status: 200, body: { id: "2" } }, { status: 200, body: { id: "3" } }], { tokenSeconds: 120 });
    const { instance } = client(paypal.fetch, () => now);
    await instance.send(get);
    await instance.send(get);
    expect(paypal.tokenCalls()).toBe(1);
    now = new Date(now.getTime() + 61_000);
    await instance.send(get);
    expect(paypal.tokenCalls()).toBe(2);
  });

  it("sends every write with its request ID, so a retry cannot repeat it", async () => {
    const paypal = scripted([{ status: 503 }, { status: 201, body: { id: "ORDER1" } }]);
    const { instance, sleeps } = client(paypal.fetch);
    await instance.send({ method: "POST", path: "/v2/checkout/orders", body: "{}", requestId: "kin-top-up-1", operation: "orders.create" });
    const writes = paypal.calls.filter((call) => call.url.endsWith("/v2/checkout/orders"));
    expect(writes).toHaveLength(2);
    for (const write of writes) expect((write.init.headers as Record<string, string>)["PayPal-Request-Id"]).toBe("kin-top-up-1");
    expect(sleeps).toEqual([200]);
  });

  it("retries a network error, a 429 and a 5xx with backoff, then reports PayPal unavailable", async () => {
    const paypal = scripted(["network", { status: 429 }, { status: 500, debugId: "dbg-3" }]);
    const { instance, sleeps, logs } = client(paypal.fetch);
    const error = await instance.send(get).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({ outcome: "unavailable", retryable: true, status: 500, debugId: "dbg-3" });
    expect(sleeps).toEqual([200, 400]);
    expect(logs.filter((line) => line.operation === "orders.get").map((line) => line.status)).toEqual([null, 429, 500]);
  });

  it("treats a body cut off by the timeout as no answer, and asks again with the same request ID", async () => {
    const paypal = scripted(["body-timeout", { status: 201, body: { id: "ORDER1" } }]);
    const { instance } = client(paypal.fetch);
    expect(await instance.send({ method: "POST", path: "/v2/checkout/orders/ORDER1/capture", body: "{}", requestId: "kin-capture-ORDER1", operation: "orders.capture" })).toEqual({ id: "ORDER1" });
    const ids = paypal.calls.filter((call) => call.url.endsWith("/capture")).map((call) => (call.init.headers as Record<string, string>)["PayPal-Request-Id"]);
    expect(ids).toEqual(["kin-capture-ORDER1", "kin-capture-ORDER1"]);
  });

  it("never takes a success it cannot read as proof, and reports PayPal unavailable after the retries", async () => {
    const paypal = scripted([{ status: 201, raw: "<html>" }, { status: 201, raw: "{" }, "body-timeout"]);
    const { instance } = client(paypal.fetch);
    await expect(instance.send(get)).rejects.toMatchObject({ outcome: "unavailable", retryable: true });
  });

  it("never retries PayPal's refusal, and names the issue", async () => {
    const paypal = scripted([{ status: 422, debugId: "dbg-1", body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }] } }]);
    const { instance } = client(paypal.fetch);
    await expect(instance.send(get)).rejects.toMatchObject({ outcome: "rejected", retryable: false, status: 422, issue: "ORDER_NOT_APPROVED", debugId: "dbg-1" });
  });

  it("renews a token PayPal stopped accepting, once", async () => {
    const paypal = scripted([{ status: 401 }, { status: 200, body: { id: "ok" } }]);
    const { instance } = client(paypal.fetch);
    expect(await instance.send(get)).toEqual({ id: "ok" });
    expect(paypal.tokenCalls()).toBe(2);
    const retried = paypal.calls.filter((call) => call.url.endsWith("/ABC12")).map((call) => (call.init.headers as Record<string, string>)["Authorization"]);
    expect(retried).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  it("logs each call's debug ID and never a credential or a token", async () => {
    const paypal = scripted([{ status: 200, body: {}, debugId: "dbg-9" }]);
    const { instance, logs } = client(paypal.fetch);
    await instance.send(get);
    expect(logs.at(-1)).toEqual({ operation: "orders.get", status: 200, debugId: "dbg-9", attempt: 1 });
    expect(JSON.stringify(logs)).not.toMatch(/secret|token-1|Basic|Bearer/);
  });
});
