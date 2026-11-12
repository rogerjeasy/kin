import { describe, expect, it } from "vitest";

import { MERCHANT_SIGNATURE_WINDOW_SECONDS, signMerchantRequest, verifyMerchantSignature } from "./merchant-signature.ts";

const SECRET = "a shared secret of at least thirty-two characters";
const NOW = new Date("2026-11-11T12:00:00Z");
const seconds = NOW.getTime() / 1000;
const order = { method: "POST", path: "/orders", rawBody: JSON.stringify({ key: "kin-purchase-1", item: "Refill", cents: 6400, currency: "USD" }) };

const verify = (header: string | null, request = order, secret = SECRET, now = NOW) => verifyMerchantSignature({ ...request, secret, header, now });

describe("a signed request from Kin's worker to the demo pharmacy", () => {
  it("is accepted with the right secret, method, path, body and time", () => {
    expect(verify(signMerchantRequest(SECRET, seconds, order))).toEqual({ ok: true });
    // The method is signed in capitals, so its spelling cannot change the signature.
    expect(verify(signMerchantRequest(SECRET, seconds, { ...order, method: "post" }))).toEqual({ ok: true });
  });

  it("is refused when a byte of the body changes, or the secret is another", () => {
    const header = signMerchantRequest(SECRET, seconds, order);
    expect(verify(header, { ...order, rawBody: `${order.rawBody} ` })).toEqual({ ok: false, reason: "mismatch" });
    expect(verify(header, order, "another shared secret, also thirty-two characters")).toEqual({ ok: false, reason: "mismatch" });
  });

  it("cannot be moved to another path or method: a read of one order is no read of another, and no write", () => {
    const read = { method: "GET", path: "/orders/order-1", rawBody: "" };
    const header = signMerchantRequest(SECRET, seconds, read);
    expect(verify(header, { ...read, path: "/orders/order-2" })).toEqual({ ok: false, reason: "mismatch" });
    expect(verify(header, { ...read, method: "POST" })).toEqual({ ok: false, reason: "mismatch" });
  });

  it("is refused outside the time window, so a captured request cannot be replayed later", () => {
    const old = seconds - MERCHANT_SIGNATURE_WINDOW_SECONDS - 1;
    expect(verify(signMerchantRequest(SECRET, old, order))).toEqual({ ok: false, reason: "stale" });
    const ahead = seconds + MERCHANT_SIGNATURE_WINDOW_SECONDS + 1;
    expect(verify(signMerchantRequest(SECRET, ahead, order))).toEqual({ ok: false, reason: "stale" });
    expect(verify(signMerchantRequest(SECRET, seconds - MERCHANT_SIGNATURE_WINDOW_SECONDS, order)).ok).toBe(true);
  });

  it("is refused when the header is missing or is not one signature", () => {
    for (const header of [null, "", "v1=abc", "t=1,v1=xyz", `t=${seconds},v1=${"a".repeat(63)}`, `t=${seconds},v1=${"A".repeat(64)}`, `t=${seconds},v0=${"a".repeat(64)}`]) {
      expect(verify(header)).toEqual({ ok: false, reason: "malformed" });
    }
  });
});
