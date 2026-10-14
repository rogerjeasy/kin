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

/** The one formatter for showing money to a person. */
export function formatMoney(money: Money, locale: string): string {
  if (!Number.isSafeInteger(money.cents)) {
    throw new InvalidMoneyError(money.cents);
  }
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
  });
  const minorDigits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
  return formatter.format(toDecimalString(money.cents, minorDigits));
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
