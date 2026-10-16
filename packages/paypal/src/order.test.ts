import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseCapture } from "./capture.ts";
import { PayPalShapeError } from "./json.ts";
import { contributionOrderBody, parseOrder } from "./order.ts";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const reference = { circleId: "0b6f4c3e-8d1a-4f6e-9c2b-5a7d3e1f9a40", memberId: "7c2e9a14-3b5d-4e8f-a1c6-d9b0f2e4a738" };

describe("a top-up order", () => {
  it("asks PayPal for one unit of the exact amount, with no shipping, naming the circle and member", () => {
    const body = JSON.parse(contributionOrderBody({ amount: { cents: 2550, currency: "USD" }, reference, description: "Top-up", returnUrl: "https://kin.test/dashboard" }));
    expect(body).toMatchObject({
      intent: "CAPTURE",
      purchase_units: [{ custom_id: `kin1:${reference.circleId}:${reference.memberId}`, amount: { currency_code: "USD", value: "25.50" } }],
      payment_source: { paypal: { experience_context: { shipping_preference: "NO_SHIPPING", return_url: "https://kin.test/dashboard" } } },
    });
  });

  it("reads the order PayPal recorded before the payer approved it", () => {
    expect(parseOrder(fixture("order-payer-action-required.json"))).toEqual({
      id: "5T37836141355693B",
      status: "PAYER_ACTION_REQUIRED",
      reference,
      amount: { cents: 2500, currency: "USD" },
      captures: [],
    });
  });

  it("reads a completed order's capture in integer cents, with PayPal's fee", () => {
    const order = parseOrder(fixture("order-completed.json"));
    expect(order.status).toBe("COMPLETED");
    expect(order.captures).toEqual([
      {
        id: "3C679366HH908993F",
        status: "COMPLETED",
        orderId: "5T37836141355693B",
        reference,
        gross: { cents: 2500, currency: "USD" },
        fee: { cents: 136, currency: "USD" },
        createdAt: new Date("2026-10-16T08:09:12Z"),
      },
    ]);
  });
});

describe("a capture", () => {
  const capture = { id: "CAP1", status: "PENDING", amount: { currency_code: "USD", value: "10.00" }, create_time: "2026-10-16T08:00:00Z" };

  it("has a zero fee while PayPal has charged none, and no reference when the custom ID is not Kin's", () => {
    expect(parseCapture({ ...capture, custom_id: "someone-else" })).toMatchObject({ status: "PENDING", fee: { cents: 0, currency: "USD" }, reference: null });
  });

  it("refuses an amount it cannot read exactly, rather than round it", () => {
    expect(() => parseCapture({ ...capture, amount: { currency_code: "USD", value: "10.005" } })).toThrow(PayPalShapeError);
    expect(() => parseCapture({ ...capture, amount: { currency_code: "USD", value: 10 } })).toThrow(PayPalShapeError);
    expect(() => parseCapture({ ...capture, create_time: "yesterday" })).toThrow(PayPalShapeError);
  });

  it("refuses a fee in another currency than the payment", () => {
    const breakdown = { seller_receivable_breakdown: { paypal_fee: { currency_code: "EUR", value: "0.30" } } };
    expect(() => parseCapture({ ...capture, ...breakdown })).toThrow(PayPalShapeError);
  });

  it("treats a status it does not know as not completed", () => {
    expect(parseCapture({ ...capture, status: "SOMETHING_NEW" }).status).toBe("OTHER");
  });
});
