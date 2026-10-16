import { describe, expect, it } from "vitest";

import { InvalidDecimalError, centsFromDecimal, decimalAmount } from "./money.ts";
import { randomCents } from "./testing/generators.ts";
import { forAll } from "./testing/property.ts";

describe("centsFromDecimal", () => {
  it.each([
    ["84", 8400],
    ["84.5", 8450],
    ["84.50", 8450],
    ["0.05", 5],
    ["0", 0],
    ["5000.00", 500000],
    ["007.10", 710],
  ])("reads %s dollars as %i cents", (text, cents) => {
    expect(centsFromDecimal(text, "USD")).toBe(cents);
  });

  it("follows the currency's own minor digits", () => {
    expect(centsFromDecimal("900", "JPY")).toBe(900);
    expect(() => centsFromDecimal("900.5", "JPY")).toThrow(InvalidDecimalError);
    expect(centsFromDecimal("1.234", "BHD")).toBe(1234);
  });

  it.each(["84.005", "-5", "+5", "1e3", "1,000.00", "84.", ".5", "", " 5", "5 ", "five", "0x10", "Infinity", "NaN", "１２"])("refuses %j rather than guess", (text) => {
    expect(() => centsFromDecimal(text, "USD")).toThrow(InvalidDecimalError);
  });

  it("refuses an amount too large to hold exactly", () => {
    expect(() => centsFromDecimal("90071992547409.92", "USD")).toThrow(InvalidDecimalError);
    expect(centsFromDecimal("90071992547409.91", "USD")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("reads back exactly what decimalAmount writes, for any amount", () => {
    forAll(randomCents, (cents) => {
      expect(centsFromDecimal(decimalAmount({ cents, currency: "USD" }), "USD")).toBe(cents);
    });
  });
});
