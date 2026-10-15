import { describe, expect, it } from "vitest";

import { payoutFeeReserve } from "./fees.ts";

describe("the payout fee reserve", () => {
  it("is what the sandbox charged to send a US dollar payout", () => {
    expect(payoutFeeReserve("USD")()).toBe(25);
  });

  it("refuses a currency whose fee nobody has checked", () => {
    expect(() => payoutFeeReserve("EUR")).toThrow(/EUR/);
  });
});
