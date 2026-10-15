/**
 * An amount of money: a whole number of the currency's minor units (cents for
 * dollars), never a fraction. `currency` is an ISO 4217 code.
 */
export type Money = {
  readonly cents: number;
  readonly currency: string;
};

/** The amount is not a whole number of minor units. Retrying cannot help. */
export class InvalidMoneyError extends Error {
  readonly retryable = false;

  constructor(cents: number) {
    super(`Money must be a whole number of minor units, got ${cents}`);
    this.name = "InvalidMoneyError";
  }
}

/** Refuses an amount that is not a whole number of minor units. */
export function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new InvalidMoneyError(cents);
  }
}

/** Adds amounts, and refuses a total too large to hold exactly. */
export function sumCents(amounts: readonly number[]): number {
  let total = 0;
  for (const cents of amounts) {
    assertCents(cents);
    total += cents;
    assertCents(total);
  }
  return total;
}

/** The one formatter for showing money to a person. */
export function formatMoney(money: Money, locale: string): string {
  assertCents(money.cents);
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
  });
  const minorDigits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
  return formatter.format(toDecimalString(money.cents, minorDigits));
}

/**
 * An amount as a plain decimal in its currency's minor digits ("84.00"), for
 * files a spreadsheet reads. Built from the integer's digits, never by division.
 */
export function decimalAmount(money: Money): string {
  assertCents(money.cents);
  const minorDigits = new Intl.NumberFormat("en", { style: "currency", currency: money.currency }).resolvedOptions().maximumFractionDigits ?? 0;
  return toDecimalString(money.cents, minorDigits);
}

// Intl formats a decimal string exactly, so no floating-point division ever
// touches the amount.
function toDecimalString(
  minorUnits: number,
  minorDigits: number,
): Intl.StringNumericLiteral {
  const sign = minorUnits < 0 ? "-" : "";
  const digits = String(Math.abs(minorUnits)).padStart(minorDigits + 1, "0");
  const cut = digits.length - minorDigits;
  const fraction = minorDigits === 0 ? "" : `.${digits.slice(cut)}`;
  // Safe: the string is built only from an integer's digits, a sign and a point.
  return `${sign}${digits.slice(0, cut)}${fraction}` as Intl.StringNumericLiteral;
}
