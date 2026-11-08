import { describe, expect, it } from "vitest";

import { INVOICE_REQUEST_STATES, INVOICE_REQUEST_TRANSITIONS, checkInvoiceRequest, invoiceRequestIsOpen, invoiceRequestMayMove } from "./invoice-request.ts";

const usd = (cents: number) => ({ cents, currency: "USD" });

describe("an invoice request's state machine", () => {
  it("moves only forward: a paid, cancelled or failed request never moves again", () => {
    for (const final of ["paid", "cancelled", "failed"] as const) {
      for (const to of INVOICE_REQUEST_STATES) expect(invoiceRequestMayMove(final, to)).toBe(false);
    }
    expect(invoiceRequestMayMove("requested", "sent")).toBe(true);
    expect(invoiceRequestMayMove("sent", "paid")).toBe(true);
    expect(invoiceRequestMayMove("sent", "requested")).toBe(false);
    expect(invoiceRequestMayMove("requested", "paid")).toBe(false);
  });

  it("lists every state it names as a target", () => {
    const targets = Object.values(INVOICE_REQUEST_TRANSITIONS).flat();
    for (const target of targets) expect(INVOICE_REQUEST_STATES).toContain(target);
  });

  it("is open while it waits on the member", () => {
    expect(INVOICE_REQUEST_STATES.filter(invoiceRequestIsOpen)).toEqual(["requested", "sent"]);
  });
});

describe("checkInvoiceRequest", () => {
  it("holds a top-up request to a top-up's limits", () => {
    expect(checkInvoiceRequest("top_up", usd(2500), null)).toEqual({ ok: true });
    expect(checkInvoiceRequest("top_up", usd(99), null)).toMatchObject({ ok: false, reason: "too_small" });
    expect(checkInvoiceRequest("top_up", usd(500_001), null)).toMatchObject({ ok: false, reason: "too_large" });
    expect(checkInvoiceRequest("top_up", { cents: 2500, currency: "EUR" }, null)).toMatchObject({ ok: false, reason: "currency" });
  });

  it("asks a settlement for exactly what the plan collects, and nothing from a member it collects nothing from", () => {
    expect(checkInvoiceRequest("settlement", usd(16600), 16600)).toEqual({ ok: true });
    expect(checkInvoiceRequest("settlement", usd(16601), 16600)).toEqual({ ok: false, reason: "not_owed" });
    expect(checkInvoiceRequest("settlement", usd(16600), null)).toEqual({ ok: false, reason: "not_owed" });
    expect(checkInvoiceRequest("settlement", usd(0), 0)).toEqual({ ok: false, reason: "not_owed" });
  });
});
