import { signMerchantRequest } from "@kin/auth";
import { DELIVERY_SCHEDULE_SECONDS } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { CATALOG } from "./catalog.ts";
import { createGate, fixedWindowLimiter } from "./gate.ts";
import { handle } from "./handler.ts";
import { createOrderBook } from "./orders.ts";
import { ChargeError, paypalSavedWallet, simulatedWallet, type WalletCharger } from "./wallet.ts";

const START = new Date("2026-11-07T10:00:00Z");
const REFILL = { key: "kin-purchase-1", item: "Monthly prescription refill (30 days)", cents: 6400, currency: "USD" };

function bookAt(wallet: WalletCharger = simulatedWallet) {
  let now = START;
  return { book: createOrderBook({ wallet, now: () => now }), later: (seconds: number) => { now = new Date(START.getTime() + seconds * 1000); } };
}

describe("the pharmacy's order book", () => {
  it("takes an order once per key, charging the wallet once however often it is asked", async () => {
    const charges: string[] = [];
    const wallet: WalletCharger = { ...simulatedWallet, charge: async ({ key, cents }) => { charges.push(`${key}:${cents}`); return { kind: "paypal", orderId: "ORDER0001", captureId: "capture-1" }; } };
    const { book } = bookAt(wallet);
    const [first, second] = await Promise.all([book.place(REFILL), book.place(REFILL)]);
    expect(second).toEqual(first);
    expect(await book.place(REFILL)).toEqual(first);
    expect(charges).toEqual(["kin-purchase-1:6400"]);
  });

  it("says a charge was simulated, with no capture ID, when its wallet charged nothing", async () => {
    const { book } = bookAt(simulatedWallet);
    expect(await book.place(REFILL)).toEqual({ ref: "order-kin-purchase-1", charge: { kind: "simulated" } });
  });

  it("refuses, before asking the wallet for anything, a price above the standing permission the buyer names", async () => {
    const charges: number[] = [];
    const { book } = bookAt({ ...simulatedWallet, charge: async ({ cents }) => { charges.push(cents); return { kind: "simulated" }; } });
    await expect(book.place({ ...REFILL, mandate: { id: "mandate-1", allowanceCents: 6399 } })).rejects.toMatchObject({ name: "AboveMandateError", retryable: false });
    expect(charges).toEqual([]);
    expect(await book.place({ ...REFILL, mandate: { id: "mandate-1", allowanceCents: 6400 } })).toMatchObject({ ref: "order-kin-purchase-1" });
    expect(charges).toEqual([6400]);
  });

  it("sells only what its catalog lists, at the catalog's price", async () => {
    const { book } = bookAt();
    await expect(book.place({ ...REFILL, cents: 100 })).rejects.toMatchObject({ name: "UnknownItemError" });
    await expect(book.place({ ...REFILL, item: "Something else" })).rejects.toMatchObject({ name: "UnknownItemError" });
    await expect(book.place({ ...REFILL, key: "has spaces" })).rejects.toMatchObject({ name: "UnknownItemError" });
  });

  it("delivers on its schedule from the moment the order was placed", async () => {
    const { book, later } = bookAt();
    const { ref } = await book.place(REFILL);
    expect(book.progress(ref)).toBe("ordered");
    later(DELIVERY_SCHEDULE_SECONDS.shipped);
    expect(book.progress(ref)).toBe("shipped");
    later(DELIVERY_SCHEDULE_SECONDS.delivered);
    expect(book.progress(ref)).toBe("delivered");
    expect(book.progress("order-unknown")).toBeNull();
  });

  it("takes no order when the wallet refuses, and lets the same key try again", async () => {
    let refuse = true;
    const wallet: WalletCharger = { ...simulatedWallet, charge: async () => { if (refuse) throw new ChargeError(true, "down"); return { kind: "paypal", orderId: "ORDER0002", captureId: "capture-2" }; } };
    const { book } = bookAt(wallet);
    await expect(book.place(REFILL)).rejects.toBeInstanceOf(ChargeError);
    expect(book.progress("order-kin-purchase-1")).toBeNull();
    refuse = false;
    expect(await book.place(REFILL)).toEqual({ ref: "order-kin-purchase-1", charge: { kind: "paypal", orderId: "ORDER0002", captureId: "capture-2" } });
  });
});

describe("the pharmacy's routes", () => {
  it("lists its catalog, labelled a stand-in", async () => {
    const reply = await handle(bookAt().book, { method: "GET", path: "/catalog", body: null });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ standIn: true, items: CATALOG });
  });

  it("takes an order and says where it is", async () => {
    const { book, later } = bookAt();
    const placed = await handle(book, { method: "POST", path: "/orders", body: REFILL });
    expect(placed).toMatchObject({ status: 201, body: { ref: "order-kin-purchase-1", standIn: true } });
    later(DELIVERY_SCHEDULE_SECONDS.out_for_delivery);
    expect(await handle(book, { method: "GET", path: "/orders/order-kin-purchase-1", body: null })).toMatchObject({ status: 200, body: { state: "out_for_delivery" } });
    expect(await handle(book, { method: "GET", path: "/orders/nothing", body: null })).toMatchObject({ status: 404 });
  });

  it("tells the buyer how it was charged: a real capture's ID, or that nothing was charged", async () => {
    const real = bookAt({ ...simulatedWallet, charge: async () => ({ kind: "paypal", orderId: "ORDER0009", captureId: "CAPTURE-9" }) }).book;
    expect(await handle(real, { method: "POST", path: "/orders", body: REFILL })).toMatchObject({ status: 201, body: { ref: "order-kin-purchase-1", charge: { kind: "paypal", orderId: "ORDER0009", captureId: "CAPTURE-9" } } });
    const simulated = await handle(bookAt(simulatedWallet).book, { method: "POST", path: "/orders", body: REFILL });
    expect(simulated).toMatchObject({ status: 201, body: { charge: { kind: "simulated" } } });
    expect(JSON.stringify(simulated.body)).not.toMatch(/capture/i);
  });

  it("takes the buyer's standing permission and enforces its allowance itself", async () => {
    const { book } = bookAt();
    const mandate = { id: "mandate-1", allowanceCents: 7000 };
    expect(await handle(book, { method: "POST", path: "/orders", body: { ...REFILL, mandate } })).toMatchObject({ status: 201 });
    const stricter = bookAt().book;
    expect(await handle(stricter, { method: "POST", path: "/orders", body: { ...REFILL, mandate: { ...mandate, allowanceCents: 5000 } } })).toEqual({ status: 403, body: { error: "above_mandate" } });
  });

  it("refuses a standing permission it cannot read", async () => {
    const { book } = bookAt();
    for (const mandate of [null, "m", { id: "m" }, { id: "has space", allowanceCents: 7000 }, { id: "m", allowanceCents: 0 }, { id: "m", allowanceCents: 70.5 }, { id: "m", allowanceCents: 7000, extra: 1 }]) {
      expect(await handle(book, { method: "POST", path: "/orders", body: { ...REFILL, mandate } })).toEqual({ status: 400, body: { error: "invalid_order" } });
    }
  });

  it("refuses an order it cannot read, with a reply that says nothing of its insides", async () => {
    const { book } = bookAt();
    for (const body of [null, "text", { ...REFILL, extra: 1 }, { ...REFILL, cents: 64.5 }, { ...REFILL, cents: -1 }, { key: 1 }]) {
      expect(await handle(book, { method: "POST", path: "/orders", body })).toEqual({ status: 400, body: { error: "invalid_order" } });
    }
    expect(await handle(book, { method: "POST", path: "/orders", body: { ...REFILL, cents: 1 } })).toEqual({ status: 422, body: { error: "unknown_item" } });
    expect(await handle(book, { method: "DELETE", path: "/orders", body: null })).toMatchObject({ status: 404 });
  });

  it("answers a wallet that refused with 402 and one that is down with 502, never with PayPal's own words", async () => {
    const refused = bookAt({ ...simulatedWallet, charge: async () => { throw new ChargeError(false, "secret provider detail"); } }).book;
    const down = bookAt({ ...simulatedWallet, charge: async () => { throw new ChargeError(true, "secret provider detail"); } }).book;
    expect(await handle(refused, { method: "POST", path: "/orders", body: REFILL })).toEqual({ status: 402, body: { error: "charge_refused" } });
    expect(await handle(down, { method: "POST", path: "/orders", body: REFILL })).toEqual({ status: 502, body: { error: "wallet_unavailable" } });
  });
});

describe("the pharmacy's daily limit and PayPal's record", () => {
  it("charges no more new orders in a day than it allows, counts no charge PayPal did not make, and starts again the next day", async () => {
    let fail = false;
    let now = START;
    const wallet: WalletCharger = { ...simulatedWallet, charge: async () => { if (fail) throw new ChargeError(true, "down"); return { kind: "simulated" }; } };
    const book = createOrderBook({ wallet, now: () => now, chargesPerDay: 2 });
    fail = true;
    await expect(book.place({ ...REFILL, key: "k-0" })).rejects.toBeInstanceOf(ChargeError);
    fail = false;
    await book.place({ ...REFILL, key: "k-1" });
    await book.place({ ...REFILL, key: "k-2" });
    // An order already taken is returned, not charged again, so it is not counted again.
    await book.place({ ...REFILL, key: "k-1" });
    await expect(book.place({ ...REFILL, key: "k-3" })).rejects.toMatchObject({ name: "DailyLimitError", retryable: true });
    expect(await handle(book, { method: "POST", path: "/orders", body: { ...REFILL, key: "k-3" } })).toEqual({ status: 429, body: { error: "daily_limit" } });
    now = new Date(START.getTime() + 24 * 3600 * 1000);
    expect(await book.place({ ...REFILL, key: "k-3" })).toMatchObject({ ref: "order-k-3" });
  });

  it("answers a payment from PayPal's record as it reads now, and nothing for an ID that is not PayPal's", async () => {
    const record = { orderId: "5O190127TN364715T", status: "COMPLETED", customId: "kin-purchase-1", capture: { id: "3C679366HH908993F", status: "COMPLETED", value: "64.00", currency: "USD" } };
    const asked: string[] = [];
    const book = bookAt({ ...simulatedWallet, readOrder: async (id) => { asked.push(id); return id === record.orderId ? record : null; } }).book;
    expect(await handle(book, { method: "GET", path: `/payments/${record.orderId}`, body: null })).toEqual({ status: 200, body: { seller: expect.any(String), standIn: true, source: "paypal_sandbox", payment: record } });
    expect(await handle(book, { method: "GET", path: "/payments/0000000000000000", body: null })).toEqual({ status: 404, body: { error: "unknown_payment" } });
    expect(await handle(book, { method: "GET", path: "/payments/not-paypal's", body: null })).toEqual({ status: 404, body: { error: "unknown_payment" } });
    expect(asked).toEqual([record.orderId, "0000000000000000"]);
    const down = bookAt({ ...simulatedWallet, readOrder: async () => { throw new ChargeError(true, "provider detail"); } }).book;
    expect(await handle(down, { method: "GET", path: `/payments/${record.orderId}`, body: null })).toEqual({ status: 502, body: { error: "wallet_unavailable" } });
    expect(await handle(bookAt().book, { method: "GET", path: `/payments/${record.orderId}`, body: null })).toEqual({ status: 404, body: { error: "unknown_payment" } });
  });
});

describe("the gate in front of the pharmacy", () => {
  const SECRET = "the worker and the pharmacy share this secret";
  const body = JSON.stringify(REFILL);
  const seconds = START.getTime() / 1000;
  const open = (limit = 100) => createGate({ book: bookAt().book, signingSecret: SECRET, limiter: fixedWindowLimiter({ limit, windowMs: 60_000, now: () => START }), now: () => START });
  const signed = (method: string, target: string, rawBody: string, at = seconds) => ({ method, target, rawBody, client: "10.0.0.1", signature: signMerchantRequest(SECRET, at, { method, path: target, rawBody }) });

  it("answers the health check to anyone, saying nothing else", async () => {
    expect(await open()({ method: "GET", target: "/health", rawBody: "", client: "x", signature: null })).toEqual({ status: 200, body: { ok: true } });
  });

  it("takes an order and reads it only when Kin's worker signed exactly that request", async () => {
    const gate = open();
    expect(await gate(signed("POST", "/orders", body))).toMatchObject({ status: 201, body: { ref: "order-kin-purchase-1" } });
    expect(await gate(signed("GET", "/orders/order-kin-purchase-1", ""))).toMatchObject({ status: 200, body: { state: "ordered" } });
    expect(await gate(signed("GET", "/catalog", ""))).toMatchObject({ status: 200 });
  });

  it("refuses an unsigned, stale, altered or misdirected request before reading its body, and says only that", async () => {
    const gate = open();
    const valid = signed("POST", "/orders", body);
    for (const request of [
      { ...valid, signature: null },
      { ...valid, signature: "t=1,v1=nonsense" },
      signed("POST", "/orders", body, seconds - 301),
      { ...valid, rawBody: JSON.stringify({ ...REFILL, cents: 1 }) },
      { ...valid, target: "/orders?again=1" },
      { ...signed("GET", "/orders/order-a", ""), target: "/orders/order-b" },
      { ...valid, signature: signMerchantRequest("somebody else's secret, long enough", seconds, { method: "POST", path: "/orders", rawBody: body }) },
      { ...valid, rawBody: "not json", signature: null },
    ]) {
      expect(await gate(request)).toEqual({ status: 401, body: { error: "unauthorized" } });
    }
    expect(await gate(signed("POST", "/orders", "not json"))).toEqual({ status: 400, body: { error: "invalid_json" } });
  });

  it("holds each client to its rate, signed or not", async () => {
    const gate = open(2);
    expect((await gate({ ...signed("GET", "/catalog", ""), signature: null })).status).toBe(401);
    expect((await gate(signed("GET", "/catalog", ""))).status).toBe(200);
    expect(await gate(signed("GET", "/catalog", ""))).toEqual({ status: 429, body: { error: "too_many_requests" } });
    expect((await gate({ ...signed("GET", "/catalog", ""), client: "10.0.0.2" })).status).toBe(200);
  });

  it("forgets a client's count when the window turns", () => {
    let now = START;
    const limiter = fixedWindowLimiter({ limit: 1, windowMs: 60_000, now: () => now });
    expect([limiter.take("a"), limiter.take("a"), limiter.take("b")]).toEqual([true, false, true]);
    now = new Date(START.getTime() + 60_000);
    expect(limiter.take("a")).toBe(true);
  });
});

describe("the saved payment method", () => {
  const order = (status: string, value = "64.00") => ({ id: "ORDER0001", status: "COMPLETED", purchase_units: [{ custom_id: "kin-purchase-1", payments: { captures: [{ id: "CAPTURE-1", status, amount: { currency_code: "USD", value } }] } }] });
  const vaulted = (kind: "paypal" | "card") => new Response(JSON.stringify({ id: "vault-1", payment_source: { [kind]: {} } }), { status: 200 });
  const wallet = (replies: Response[], seen: { path: string; init: RequestInit }[] = []) =>
    paypalSavedWallet({
      baseUrl: "https://paypal.test",
      clientId: "id",
      clientSecret: "secret",
      vaultId: "vault-1",
      send: async (url, init) => {
        seen.push({ path: new URL(String(url)).pathname, init: init ?? {} });
        return replies.shift() ?? new Response(null, { status: 500 });
      },
    });
  const token = () => new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
  const charge = { key: "kin-purchase-1", cents: 6400, currency: "USD", description: "Refill" };
  const created = (status = "COMPLETED", value = "64.00") => new Response(JSON.stringify(order(status, value)), { status: 201 });

  it("creates and captures one order that carries only the saved wallet and the buyer's key, with the key as PayPal's request ID", async () => {
    const seen: { path: string; init: RequestInit }[] = [];
    const result = await wallet([token(), vaulted("paypal"), created()], seen).charge(charge);
    expect(result).toEqual({ kind: "paypal", orderId: "ORDER0001", captureId: "CAPTURE-1" });
    expect(seen.map((call) => call.path)).toEqual(["/v1/oauth2/token", "/v3/vault/payment-tokens/vault-1", "/v2/checkout/orders"]);
    expect((seen[2]?.init.headers as Record<string, string>)["paypal-request-id"]).toBe("kin-purchase-1");
    expect(JSON.parse(String(seen[2]?.init.body))).toMatchObject({ intent: "CAPTURE", purchase_units: [{ custom_id: "kin-purchase-1", amount: { currency_code: "USD", value: "64.00" } }], payment_source: { paypal: { vault_id: "vault-1" } } });
  });

  it("charges a saved card as a merchant-initiated payment, and reads the kind of payment method only once", async () => {
    const seen: { path: string; init: RequestInit }[] = [];
    const card = wallet([token(), vaulted("card"), created(), token(), created()], seen);
    await card.charge(charge);
    await card.charge({ ...charge, key: "kin-purchase-2" });
    expect(seen.filter((call) => call.path.startsWith("/v3/vault")).length).toBe(1);
    expect(JSON.parse(String(seen[2]?.init.body)).payment_source).toEqual({ card: { vault_id: "vault-1", stored_credential: { payment_initiator: "MERCHANT", payment_type: "UNSCHEDULED", usage: "SUBSEQUENT" } } });
  });

  it("counts the charge made only if PayPal's record shows it completed for exactly the amount", async () => {
    await expect(wallet([token(), vaulted("paypal"), created("PENDING")]).charge(charge)).rejects.toMatchObject({ retryable: false });
    await expect(wallet([token(), vaulted("paypal"), created("COMPLETED", "63.00")]).charge(charge)).rejects.toMatchObject({ retryable: false });
    await expect(wallet([token(), vaulted("paypal"), new Response(JSON.stringify({ id: "ORDER0001", status: "CREATED" }), { status: 201 })]).charge(charge)).rejects.toMatchObject({ retryable: false });
  });

  it("separates a refusal, which asking again cannot change, from an outage, which it may", async () => {
    await expect(wallet([token(), vaulted("paypal"), new Response("{}", { status: 422 })]).charge(charge)).rejects.toMatchObject({ retryable: false });
    await expect(wallet([token(), vaulted("paypal"), new Response("{}", { status: 503 })]).charge(charge)).rejects.toMatchObject({ retryable: true });
    await expect(wallet([new Response("{}", { status: 500 })]).charge(charge)).rejects.toMatchObject({ retryable: true });
    // A payment token PayPal does not have, or one of another kind, is final.
    await expect(wallet([token(), new Response("{}", { status: 404 })]).charge(charge)).rejects.toMatchObject({ retryable: false });
    await expect(wallet([token(), new Response(JSON.stringify({ payment_source: { venmo: {} } }), { status: 200 })]).charge(charge)).rejects.toMatchObject({ retryable: false });
  });

  it("reads an order back from PayPal, never sending PayPal an ID that is not one", async () => {
    const seen: { path: string; init: RequestInit }[] = [];
    const reader = wallet([token(), new Response(JSON.stringify(order("COMPLETED")), { status: 200 }), token(), new Response("{}", { status: 404 })], seen);
    expect(await reader.readOrder("ORDER0001")).toEqual({ orderId: "ORDER0001", status: "COMPLETED", customId: "kin-purchase-1", capture: { id: "CAPTURE-1", status: "COMPLETED", value: "64.00", currency: "USD" } });
    expect(await reader.readOrder("ORDER0002")).toBeNull();
    expect(await reader.readOrder("../v1/oauth2/token")).toBeNull();
    expect(seen.map((call) => `${call.init.method} ${call.path}`)).toEqual(["POST /v1/oauth2/token", "GET /v2/checkout/orders/ORDER0001", "POST /v1/oauth2/token", "GET /v2/checkout/orders/ORDER0002"]);
  });
});
