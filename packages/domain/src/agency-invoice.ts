import { MAX_SHIFT_MINUTES, type ShiftKind, type ShiftState } from "./shift.ts";
import { matchVisitReport, type ReportableShift } from "./visit-report.ts";

/**
 * An invoice a home-care agency's billing software sends Kin through the same
 * signed API as its visits (docs/architecture.md section 13.5, decision 111).
 * An invoice pays nothing by itself: it becomes a bill on the circle's Bills
 * screen, cross-checked against the visits the family gave its word on, and a
 * person reviews it like any bill read from a letter. Only then does the
 * agreement's approval path decide whether it is paid.
 *
 * The schema is written once, here, as JSON Schema. The OpenAPI document
 * publishes it as it is and `parseAgencyInvoice` checks a request against the
 * same object, so the two cannot disagree. Every amount is integer minor
 * units; Kin adds the lines up itself and refuses a total that differs.
 */

/** The most lines one invoice holds: a month of daily visits, three times over. */
export const MAX_INVOICE_LINES = 100;
/** The longest period one invoice covers. */
export const MAX_INVOICE_PERIOD_DAYS = 92;
/** The purpose key a payment raised from an agency's invoice carries. */
export const AGENCY_INVOICE_PURPOSE = "agency_invoice";

const DAY_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
const MAX_CENTS = Number.MAX_SAFE_INTEGER;

type Schema =
  | { readonly type: "string"; readonly description: string; readonly maxLength: number; readonly pattern?: string; readonly format?: "date" | "email" }
  | { readonly type: "integer"; readonly description: string; readonly minimum: number; readonly maximum: number }
  | { readonly type: "array"; readonly description: string; readonly minItems: number; readonly maxItems: number; readonly items: Schema }
  | { readonly type: "object"; readonly title?: string; readonly description: string; readonly additionalProperties: false; readonly required: readonly string[]; readonly properties: Readonly<Record<string, Schema>> };

export const AGENCY_INVOICE_LINE_SCHEMA = {
  type: "object",
  title: "AgencyInvoiceLine",
  description: "One visit the agency charges for. It must be a visit this agency already reported to the circle through POST /api/v1/visits.",
  additionalProperties: false,
  required: ["visitId", "minutes", "amountCents", "currency"],
  properties: {
    visitId: { type: "string", description: "The externalId the agency reported the visit under.", maxLength: 80, pattern: "^[A-Za-z0-9._:-]+$" },
    minutes: { type: "integer", description: "The whole minutes charged for.", minimum: 1, maximum: MAX_SHIFT_MINUTES },
    amountCents: { type: "integer", description: "What the line costs, in integer minor units (cents).", minimum: 1, maximum: MAX_CENTS },
    currency: { type: "string", description: "ISO 4217 code. Every line and the total are in the circle's currency.", maxLength: 3, pattern: "^[A-Z]{3}$" },
  },
} as const satisfies Schema;

export const AGENCY_INVOICE_SCHEMA = {
  type: "object",
  title: "AgencyInvoice",
  description: "An invoice for visits the agency reported. Kin keeps it as a bill for the family to review against the visits it confirmed; it pays nothing by itself.",
  additionalProperties: false,
  required: ["invoiceNumber", "periodStart", "periodEnd", "lines", "totalCents", "currency", "dueOn"],
  properties: {
    invoiceNumber: { type: "string", description: "The agency's own invoice number. Sending the same number and body again changes nothing; another body under it is refused.", maxLength: 40, pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]*$" },
    periodStart: { type: "string", format: "date", description: "The first day the invoice covers (YYYY-MM-DD).", maxLength: 10, pattern: DAY_PATTERN },
    periodEnd: { type: "string", format: "date", description: `The last day it covers, at most ${MAX_INVOICE_PERIOD_DAYS} days after the first.`, maxLength: 10, pattern: DAY_PATTERN },
    lines: { type: "array", description: "The visits charged for, each at most once.", minItems: 1, maxItems: MAX_INVOICE_LINES, items: AGENCY_INVOICE_LINE_SCHEMA },
    totalCents: { type: "integer", description: "The sum of the lines in integer minor units. Kin adds the lines up and refuses a total that differs.", minimum: 1, maximum: MAX_CENTS },
    currency: { type: "string", description: "ISO 4217 code: the circle's currency.", maxLength: 3, pattern: "^[A-Z]{3}$" },
    dueOn: { type: "string", format: "date", description: "When payment is due (YYYY-MM-DD).", maxLength: 10, pattern: DAY_PATTERN },
    paypalEmail: { type: "string", format: "email", description: "Where the agency takes PayPal. Only with it can the family pay through PayPal Payouts, after review and every yes the agreement asks for.", maxLength: 127, pattern: "^[^@\\s<>{}]+@[^@\\s<>{}]+\\.[^@\\s<>{}]+$" },
  },
} as const satisfies Schema;

export type AgencyInvoiceLine = { readonly visitId: string; readonly minutes: number; readonly amountCents: number };

export type AgencyInvoice = {
  readonly invoiceNumber: string;
  /** YYYY-MM-DD. */
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly lines: readonly AgencyInvoiceLine[];
  readonly totalCents: number;
  readonly currency: string;
  readonly dueOn: string;
  /** Lowercased; `null` when the agency takes no PayPal. */
  readonly paypalEmail: string | null;
};

/**
 * `shape`: not the schema. `total`: the lines do not add up to the total.
 * `currency`: a line in another currency than the invoice. `duplicate_line`:
 * one visit charged twice. `period`: not a real period of at most 92 days.
 */
export type AgencyInvoiceRefusal = "shape" | "total" | "currency" | "duplicate_line" | "period";

function follows(schema: Schema, value: unknown): boolean {
  switch (schema.type) {
    case "string":
      return typeof value === "string" && value.length > 0 && value.length <= schema.maxLength && value.trim() === value && (schema.pattern === undefined || new RegExp(schema.pattern, "u").test(value));
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value) && value >= schema.minimum && value <= schema.maximum;
    case "array":
      return Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems && value.every((item) => follows(schema.items, item));
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
      const entries = Object.entries(value);
      if (entries.some(([key, field]) => !Object.hasOwn(schema.properties, key) || !follows(schema.properties[key] as Schema, field))) return false;
      return schema.required.every((key) => Object.hasOwn(value, key));
    }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC midnight a real YYYY-MM-DD names, or `null` for 2026-02-30. */
function dayNumber(day: string): number | null {
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day ? null : time;
}

/** Adds the lines in integer minor units, or `null` when the sum is too large to hold exactly. */
export function invoiceLinesTotal(lines: readonly Pick<AgencyInvoiceLine, "amountCents">[]): number | null {
  let total = 0;
  for (const line of lines) {
    total += line.amountCents;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

type RawLine = { readonly visitId: string; readonly minutes: number; readonly amountCents: number; readonly currency: string };
type RawInvoice = Omit<AgencyInvoice, "lines" | "paypalEmail"> & { readonly lines: readonly RawLine[]; readonly paypalEmail?: string };

/** An agency's invoice, or why it is refused. Nothing is coerced or trimmed into shape. */
export function parseAgencyInvoice(input: unknown): { readonly ok: true; readonly invoice: AgencyInvoice } | { readonly ok: false; readonly reason: AgencyInvoiceRefusal } {
  if (!follows(AGENCY_INVOICE_SCHEMA, input)) return { ok: false, reason: "shape" };
  const raw = input as RawInvoice;
  const start = dayNumber(raw.periodStart);
  const end = dayNumber(raw.periodEnd);
  if (start === null || end === null || dayNumber(raw.dueOn) === null || end < start || (end - start) / DAY_MS > MAX_INVOICE_PERIOD_DAYS) return { ok: false, reason: "period" };
  if (raw.lines.some((line) => line.currency !== raw.currency)) return { ok: false, reason: "currency" };
  if (new Set(raw.lines.map((line) => line.visitId)).size !== raw.lines.length) return { ok: false, reason: "duplicate_line" };
  if (invoiceLinesTotal(raw.lines) !== raw.totalCents) return { ok: false, reason: "total" };
  return {
    ok: true,
    invoice: {
      invoiceNumber: raw.invoiceNumber,
      periodStart: raw.periodStart,
      periodEnd: raw.periodEnd,
      lines: raw.lines.map(({ visitId, minutes, amountCents }) => ({ visitId, minutes, amountCents })),
      totalCents: raw.totalCents,
      currency: raw.currency,
      dueOn: raw.dueOn,
      paypalEmail: raw.paypalEmail === undefined ? null : raw.paypalEmail.toLowerCase(),
    },
  };
}

/**
 * What the family should know about one line before it says yes:
 * `no_family_word`: no shift on Kin's calendar matches the visit, or the
 * family has not given its word on it. `hours_differ`: the minutes charged
 * are not the minutes between the shift's own check-in and check-out.
 * `paid_already`: Kin already paid the caregiver for that shift.
 */
export type InvoiceLineFlag = "no_family_word" | "hours_differ" | "paid_already";

/** A shift as the cross-check needs it: the domain's matching fields, the family's word and the caregiver's keys. */
export type CheckableShift = ReportableShift & {
  readonly state: ShiftState;
  readonly familyConfirmedAt: Date | null;
  readonly checkedInAt: Date | null;
  readonly checkedOutAt: Date | null;
};

/** The visit a line points at, as the agency reported it. */
export type InvoicedVisit = { readonly memberId: string | null; readonly kind: ShiftKind; readonly startsAt: Date; readonly endsAt: Date };

export type CheckedInvoiceLine = { readonly shiftId: string | null; readonly flags: readonly InvoiceLineFlag[] };

const MINUTE_MS = 60_000;

/**
 * One line held against Kin's own calendar. Plain code decides it; a flag is
 * a warning for the person reviewing, never a refusal and never a payment.
 */
export function checkInvoiceLine(line: Pick<AgencyInvoiceLine, "minutes">, visit: InvoicedVisit, shifts: readonly CheckableShift[]): CheckedInvoiceLine {
  const shiftId = matchVisitReport(visit, shifts);
  const shift = shifts.find((each) => each.id === shiftId);
  if (shift === undefined) return { shiftId: null, flags: ["no_family_word"] };
  const flags: InvoiceLineFlag[] = [];
  if (shift.familyConfirmedAt === null) flags.push("no_family_word");
  if (shift.checkedInAt !== null && shift.checkedOutAt !== null && Math.floor((shift.checkedOutAt.getTime() - shift.checkedInAt.getTime()) / MINUTE_MS) !== line.minutes) flags.push("hours_differ");
  if (shift.state === "paid") flags.push("paid_already");
  return { shiftId: shift.id, flags };
}

/**
 * Where an invoice stands, as Kin tells the agency: nothing about the family
 * beyond it. `received`: waiting for a person to review it. `under_review`:
 * reviewed and waiting for the yeses the agreement asks for. `approved`: the
 * family said yes, or kept it to pay outside Kin. `paid`: PayPal's record, or
 * the family's recorded payment, says it was paid. `declined`.
 */
export const AGENCY_INVOICE_STATUSES = ["received", "under_review", "approved", "paid", "declined"] as const;
export type AgencyInvoiceStatus = (typeof AGENCY_INVOICE_STATUSES)[number];
