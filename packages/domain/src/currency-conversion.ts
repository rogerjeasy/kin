import { assertCents, minorDigitsOf, type Money } from "./money.ts";

/**
 * Cross-border circles: a member may give in their own currency while the
 * pool and the ledger stay in the circle's. A conversion is a pure,
 * rate-stamped calculation. The rate is an input (never fetched here, never
 * chosen by a model), and the result carries the stamp so the record can show
 * exactly which rate produced it.
 */

/**
 * Units of each currency that one US dollar buys, in millionths (1.0678 is
 * 1,067,800). A whole number, so no rate is ever a floating-point value.
 */
export type RateTable = {
  readonly asOf: string;
  /** `true` for a fixed demo table. Real rates would come from PayPal's record (architecture.md section 7). */
  readonly simulated: boolean;
  readonly perUsdPpm: Readonly<Record<string, number>>;
};

/**
 * The demo's fixed rates. They are invented for the demo and never move, so
 * the demo is repeatable. Sandbox multi-currency is unverified
 * (architecture.md section 23), so the interface labels them simulated.
 */
export const SIMULATED_RATES: RateTable = {
  asOf: "2026-11-01",
  simulated: true,
  perUsdPpm: {
    USD: 1_000_000,
    EUR: 920_000,
    GBP: 790_000,
    CAD: 1_370_000,
    CHF: 880_000,
    JPY: 150_000_000,
    MXN: 18_500_000,
  },
};

/** The rate behind a conversion, kept with it so the record can show how it was reached. */
export type ConversionStamp = {
  readonly from: string;
  readonly to: string;
  readonly fromPerUsdPpm: number;
  readonly toPerUsdPpm: number;
  readonly asOf: string;
  readonly simulated: boolean;
};

export type ConvertedMoney = {
  readonly source: Money;
  readonly result: Money;
  readonly stamp: ConversionStamp;
};

/** No rate is known for a currency, or the result is too large to hold exactly. Retrying cannot help. */
export class CurrencyConversionError extends Error {
  readonly retryable = false;

  readonly currency: string;

  constructor(currency: string) {
    super(`No usable rate for ${currency}`);
    this.name = "CurrencyConversionError";
    this.currency = currency;
  }
}

/**
 * Converts an amount, exactly, with a single rounding. The one rounding rule:
 * the result is rounded to the nearest minor unit of the target currency, and
 * a half rounds away from zero. The sum of separately converted amounts can
 * therefore differ from the conversion of their sum by at most one minor
 * unit; the pool is always credited the converted amount itself, so a ledger
 * entry balances in the circle's currency.
 */
export function convertMoney(amount: Money, to: string, rates: RateTable): ConvertedMoney {
  assertCents(amount.cents);
  const fromPerUsd = rateOf(rates, amount.currency);
  const toPerUsd = rateOf(rates, to);
  const stamp: ConversionStamp = {
    from: amount.currency,
    to,
    fromPerUsdPpm: fromPerUsd,
    toPerUsdPpm: toPerUsd,
    asOf: rates.asOf,
    simulated: rates.simulated,
  };
  if (amount.currency === to) return { source: amount, result: amount, stamp };

  // result = cents × (toPerUsd / fromPerUsd) × 10^(toDigits − fromDigits), all in BigInt.
  const digitShift = minorDigitsOf(to) - minorDigitsOf(amount.currency);
  const scaleUp = digitShift > 0 ? 10n ** BigInt(digitShift) : 1n;
  const scaleDown = digitShift < 0 ? 10n ** BigInt(-digitShift) : 1n;
  const numerator = BigInt(amount.cents) * BigInt(toPerUsd) * scaleUp;
  const denominator = BigInt(fromPerUsd) * scaleDown;
  const cents = roundHalfAwayFromZero(numerator, denominator);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CurrencyConversionError(to);
  }
  return { source: amount, result: { cents: Number(cents), currency: to }, stamp };
}

function rateOf(rates: RateTable, currency: string): number {
  const rate = rates.perUsdPpm[currency];
  if (rate === undefined || !Number.isSafeInteger(rate) || rate <= 0) throw new CurrencyConversionError(currency);
  return rate;
}

function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const rounded = (2n * magnitude + denominator) / (2n * denominator);
  return negative ? -rounded : rounded;
}
