import { DELIVERY_SCHEDULE_SECONDS } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { CATALOG } from "./catalog.ts";
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
    const wallet: WalletCharger = { charge: async ({ key, cents }) => { charges.push(`${key}:${cents}`); return { kind: "paypal", captureId: "capture-1" }; } };
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
    const { book } = bookAt({ charge: async ({ cents }) => { charges.push(cents); return { kind: "simulated" }; } });
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
    const wallet: WalletCharger = { charge: async () => { if (refuse) throw new ChargeError(true, "down"); return { kind: "paypal", captureId: "capture-2" }; } };
    const { book } = bookAt(wallet);
    await expect(book.place(REFILL)).rejects.toBeInstanceOf(ChargeError);
    expect(book.progress("order-kin-purchase-1")).toBeNull();
    refuse = false;
    expect(await book.place(REFILL)).toEqual({ ref: "order-kin-purchase-1", charge: { kind: "paypal", captureId: "capture-2" } });
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
    const real = bookAt({ charge: async () => ({ kind: "paypal", captureId: "CAPTURE-9" }) }).book;
    expect(await handle(real, { method: "POST", path: "/orders", body: REFILL })).toMatchObject({ status: 201, body: { ref: "order-kin-purchase-1", charge: { kind: "paypal", captureId: "CAPTURE-9" } } });
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
    const refused = bookAt({ charge: async () => { throw new ChargeError(false, "secret provider detail"); } }).book;
    const down = bookAt({ charge: async () => { throw new ChargeError(true, "secret provider detail"); } }).book;
    expect(await handle(refused, { method: "POST", path: "/orders", body: REFILL })).toEqual({ status: 402, body: { error: "charge_refused" } });
    expect(await handle(down, { method: "POST", path: "/orders", body: REFILL })).toEqual({ status: 502, body: { error: "wallet_unavailable" } });
  });
});

describe("the saved PayPal wallet", () => {
  const capture = (status: string, value = "64.00") => ({ id: "ORDER-1", purchase_units: [{ payments: { captures: [{ id: "CAPTURE-1", status, amount: { currency_code: "USD", value } }] } }] });
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

  it("creates and captures one order that carries only the saved wallet, with the key as PayPal's request ID", async () => {
    const seen: { path: string; init: RequestInit }[] = [];
    const result = await wallet([token(), new Response(JSON.stringify(capture("COMPLETED")), { status: 201 })], seen).charge(charge);
    expect(result).toEqual({ kind: "paypal", captureId: "CAPTURE-1" });
    expect(seen.map((call) => call.path)).toEqual(["/v1/oauth2/token", "/v2/checkout/orders"]);
    expect((seen[1]?.init.headers as Record<string, string>)["paypal-request-id"]).toBe("kin-purchase-1");
    expect(JSON.parse(String(seen[1]?.init.body))).toMatchObject({ intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value: "64.00" } }], payment_source: { paypal: { vault_id: "vault-1" } } });
  });

  it("counts the charge made only if PayPal's record shows it completed for exactly the amount", async () => {
    await expect(wallet([token(), new Response(JSON.stringify(capture("PENDING")), { status: 201 })]).charge(charge)).rejects.toMatchObject({ retryable: false });
    await expect(wallet([token(), new Response(JSON.stringify(capture("COMPLETED", "63.00")), { status: 201 })]).charge(charge)).rejects.toMatchObject({ retryable: false });
    await expect(wallet([token(), new Response(JSON.stringify({ id: "ORDER-1" }), { status: 201 })]).charge(charge)).rejects.toMatchObject({ retryable: false });
  });

  it("separates a refusal, which asking again cannot change, from an outage, which it may", async () => {
    await expect(wallet([token(), new Response("{}", { status: 422 })]).charge(charge)).rejects.toMatchObject({ retryable: false });
    await expect(wallet([token(), new Response("{}", { status: 503 })]).charge(charge)).rejects.toMatchObject({ retryable: true });
    await expect(wallet([new Response("{}", { status: 500 })]).charge(charge)).rejects.toMatchObject({ retryable: true });
  });
});
