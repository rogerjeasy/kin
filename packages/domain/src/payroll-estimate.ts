import { assertCents, sumCents } from "./money.ts";

/**
 * What a family that employs a caregiver at home may owe the government, as an
 * estimate for its accountant. Kin does not file anything and does not say the
 * family complies. Every figure is a dated row of one table, from IRS
 * Publication 926 and the Social Security Administration's yearly wage base;
 * check a row against the publication before relying on it.
 */
export type HouseholdTaxYear = {
  readonly year: number;
  /** Cash wages to one household employee in the year at which Social Security and Medicare tax start. */
  readonly thresholdCents: number;
  /** Social Security tax applies to the first this many cents of one employee's wages. */
  readonly socialSecurityWageBaseCents: number;
};

/** Both shares, as the family pays them if it pays the employee's share too: 6.2% and 1.45% each, in basis points of the wages. */
export const SOCIAL_SECURITY_BPS = 1240;
export const MEDICARE_BPS = 290;
/** The federal unemployment tax: 6.0% of the first $7 000, less the 5.4% credit when state tax is paid on time. */
export const FUTA_NET_BPS = 60;
export const FUTA_WAGE_BASE_CENTS = 700_000;
/** FUTA starts in a quarter in which the family paid household employees this much in cash. */
export const FUTA_QUARTER_TRIGGER_CENTS = 100_000;

export const HOUSEHOLD_TAX_YEARS: readonly HouseholdTaxYear[] = [
  { year: 2024, thresholdCents: 270_000, socialSecurityWageBaseCents: 16_860_000 },
  { year: 2025, thresholdCents: 280_000, socialSecurityWageBaseCents: 17_610_000 },
  { year: 2026, thresholdCents: 300_000, socialSecurityWageBaseCents: 18_450_000 },
];

export const HOUSEHOLD_TAX_SOURCE = "IRS Publication 926 and SSA's contribution and benefit base, as of November 2026";

export type EmployeeYearPayments = {
  readonly employee: string;
  readonly year: number;
  /** Cash wages paid in each calendar quarter, in cents. */
  readonly quarterCents: readonly [number, number, number, number];
};

export type HouseholdTaxEstimate = {
  readonly employee: string;
  readonly year: number;
  readonly wagesCents: number;
  /** `false` for a year the table has no row for: nothing is estimated and the accountant is told so. */
  readonly known: boolean;
  readonly thresholdCents: number | null;
  readonly aboveThreshold: boolean;
  readonly socialSecurityCents: number;
  readonly medicareCents: number;
  readonly futaCents: number;
  readonly totalCents: number;
};

/** Cents times basis points, half up, without leaving integers. */
export function bpsOf(cents: number, bps: number): number {
  assertCents(cents);
  return Number((BigInt(cents) * BigInt(bps) + 5000n) / 10000n);
}

/**
 * Estimates one employee's year: Social Security and Medicare on all cash
 * wages once the year's threshold is reached (Social Security only up to the
 * wage base), and the federal unemployment tax when a quarter reached the
 * trigger. Wages to the employer's spouse, or to the employer's child under 21,
 * are exempt from the first; this estimate does not know the relation, so the
 * accountant applies it.
 */
export function estimateHouseholdTax(payments: EmployeeYearPayments): HouseholdTaxEstimate {
  const wagesCents = sumCents([...payments.quarterCents]);
  const row = HOUSEHOLD_TAX_YEARS.find((each) => each.year === payments.year);
  if (row === undefined) {
    return { employee: payments.employee, year: payments.year, wagesCents, known: false, thresholdCents: null, aboveThreshold: false, socialSecurityCents: 0, medicareCents: 0, futaCents: 0, totalCents: 0 };
  }
  const aboveThreshold = wagesCents >= row.thresholdCents;
  const socialSecurityCents = aboveThreshold ? bpsOf(Math.min(wagesCents, row.socialSecurityWageBaseCents), SOCIAL_SECURITY_BPS) : 0;
  const medicareCents = aboveThreshold ? bpsOf(wagesCents, MEDICARE_BPS) : 0;
  const futaCents = payments.quarterCents.some((quarter) => quarter >= FUTA_QUARTER_TRIGGER_CENTS) ? bpsOf(Math.min(wagesCents, FUTA_WAGE_BASE_CENTS), FUTA_NET_BPS) : 0;
  return {
    employee: payments.employee,
    year: payments.year,
    wagesCents,
    known: true,
    thresholdCents: row.thresholdCents,
    aboveThreshold,
    socialSecurityCents,
    medicareCents,
    futaCents,
    totalCents: sumCents([socialSecurityCents, medicareCents, futaCents]),
  };
}

/** The quarter, 0 to 3, of a `YYYY-MM-DD` day. */
export function quarterOf(day: string): number {
  return Math.trunc((Number(day.slice(5, 7)) - 1) / 3);
}
