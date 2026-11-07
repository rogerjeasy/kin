import { describe, expect, it } from "vitest";

import { CurrencyConversionError, SIMULATED_RATES, convertMoney } from "./currency-conversion.ts";
import { forAll } from "./testing/property.ts";

const usd = (cents: number) => ({ cents, currency: "USD" });

describe("convertMoney", () => {
  it("converts at the stamped rate and keeps the stamp", () => {
    const { result, stamp } = convertMoney(usd(10000), "EUR", SIMULATED_RATES);
    expect(result).toEqual({ cents: 9200, currency: "EUR" });
    expect(stamp).toMatchObject({ from: "USD", to: "EUR", toPerUsdPpm: 920000, simulated: true });
  });

  it("leaves an amount in the same currency untouched", () => {
    expect(convertMoney(usd(12345), "USD", SIMULATED_RATES).result).toEqual(usd(12345));
  });

  it("rounds to the nearest unit, and a half away from zero", () => {
    expect(convertMoney(usd(1), "EUR", SIMULATED_RATES).result.cents).toBe(1); // 0.92
    expect(convertMoney(usd(-1), "EUR", SIMULATED_RATES).result.cents).toBe(-1);
    // 25 cents × 0.79 = 19.75 -> 20; 50 cents × 0.79 = 39.5 -> 40
    expect(convertMoney(usd(50), "GBP", SIMULATED_RATES).result.cents).toBe(40);
    expect(convertMoney(usd(-50), "GBP", SIMULATED_RATES).result.cents).toBe(-40);
  });

  it("respects currencies without minor units", () => {
    expect(convertMoney(usd(10000), "JPY", SIMULATED_RATES).result).toEqual({ cents: 15000, currency: "JPY" });
  });

  it("refuses a currency with no rate", () => {
    expect(() => convertMoney(usd(1), "XYZ", SIMULATED_RATES)).toThrow(CurrencyConversionError);
  });

  it("is monotonic, sign-symmetric and loses or gains at most one unit when split", () => {
    const codes = Object.keys(SIMULATED_RATES.perUsdPpm) as [string, ...string[]];
    forAll(
      (random) => ({ cents: random.int(0, 10_000_000_000), more: random.int(0, 10_000_000), from: random.pick(codes), to: random.pick(codes) }),
      ({ cents, more, from, to }) => {
        const convert = (value: number) => convertMoney({ cents: value, currency: from }, to, SIMULATED_RATES).result.cents;
        expect(convert(cents + more)).toBeGreaterThanOrEqual(convert(cents));
        expect(Math.abs(convert(cents) + convert(more) - convert(cents + more))).toBeLessThanOrEqual(1);
        expect(convert(-cents)).toBe(-convert(cents));
      },
    );
  });
});
