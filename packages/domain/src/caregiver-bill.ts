import { CareValueError, careValueCents } from "./care.ts";
import { InvalidMoneyError, sumCents } from "./money.ts";

export type CaregiverVisit = { readonly date: string; readonly minutes: number };
export type CaregiverBillDetails = {
  readonly version: 1;
  readonly currency: string;
  readonly rateCentsPerHour: number;
  readonly visits: readonly CaregiverVisit[];
};
export type CaregiverBill = {
  readonly details: CaregiverBillDetails;
  readonly lines: readonly (CaregiverVisit & { readonly cents: number })[];
  readonly cents: number;
};

export class CaregiverBillError extends Error {
  readonly retryable = false;
  readonly reason: "invalid" | "date" | "future" | "duplicate_date" | "rate" | "amount";
  constructor(reason: CaregiverBillError["reason"]) {
    super(`Cannot prepare caregiver bill: ${reason}`);
    this.reason = reason;
    this.name = "CaregiverBillError";
  }
}

/** Validates the shared snapshot and values each service day with the existing care arithmetic. */
export function calculateCaregiverBill(input: unknown, today?: string): CaregiverBill {
  const details = parseCaregiverBillDetails(input, today);
  try {
    const lines = details.visits.map((visit) => ({ ...visit, cents: careValueCents(visit.minutes, details.rateCentsPerHour) }));
    const cents = sumCents(lines.map((line) => line.cents));
    if (cents <= 0) fail("amount");
    return { details, lines, cents };
  } catch (error) {
    if (error instanceof CareValueError || error instanceof InvalidMoneyError) fail("amount");
    throw error;
  }
}

/** Shared structural validation, also usable by a client without calculating money. */
export function parseCaregiverBillDetails(input: unknown, today?: string): CaregiverBillDetails {
  const row = record(input, ["version", "currency", "rateCentsPerHour", "visits"]);
  if (row.version !== 1 || typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency)) fail("invalid");
  const rate = row.rateCentsPerHour;
  if (typeof rate !== "number" || !Number.isSafeInteger(rate) || rate <= 0) fail("rate");
  if (!Array.isArray(row.visits) || row.visits.length === 0) fail("invalid");
  if (today !== undefined && !isServiceDate(today)) fail("date");
  const visits = row.visits.map((value: unknown): CaregiverVisit => {
    const visit = record(value, ["date", "minutes"]);
    if (typeof visit.date !== "string" || !isServiceDate(visit.date)) fail("date");
    if (today !== undefined && visit.date > today) fail("future");
    if (typeof visit.minutes !== "number" || !Number.isSafeInteger(visit.minutes) || visit.minutes <= 0 || visit.minutes > 1440) fail("invalid");
    return { date: visit.date, minutes: visit.minutes };
  }).toSorted((a, b) => a.date.localeCompare(b.date));
  if (new Set(visits.map((visit) => visit.date)).size !== visits.length) fail("duplicate_date");
  return { version: 1, currency: row.currency, rateCentsPerHour: rate, visits };
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("invalid");
  if (Object.keys(value).some((key) => !keys.includes(key))) fail("invalid");
  return value as Record<string, unknown>;
}

function isServiceDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "0001-01-01" && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function fail(reason: CaregiverBillError["reason"]): never {
  throw new CaregiverBillError(reason);
}
