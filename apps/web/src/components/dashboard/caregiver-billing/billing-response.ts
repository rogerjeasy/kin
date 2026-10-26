import { CaregiverBillError, parseCaregiverBillDetails } from "@kin/domain";
import type { BillingFailure, BillingResult } from "@/server/caregiver-billing";

const unavailable: BillingResult = { ok: false, reason: "unavailable" };

/** Validate the network response's shape while keeping all bill valuation on the server. */
export function parseBillingResponse(value: unknown, errors: Record<BillingFailure, string>): BillingResult {
  const row = object(value);
  if (row?.ok === false && typeof row.reason === "string" && Object.hasOwn(errors, row.reason)) {
    const billId = row.reason === "duplicate" && typeof row.billId === "string" && /^[0-9a-f-]{36}$/.test(row.billId) ? row.billId : null;
    return { ok: false, reason: row.reason as BillingFailure, ...(billId === null ? {} : { billId }) };
  }
  if (row?.ok !== true) return unavailable;
  if (typeof row.id === "string" && row.id !== "") return { ok: true, id: row.id };
  const bill = object(row.bill);
  if (!bill || !cents(bill.cents) || typeof row.submissionKey !== "string" || !Array.isArray(bill.lines)) return unavailable;
  try {
    const details = parseCaregiverBillDetails(bill.details);
    if (details.visits.length !== bill.lines.length) return unavailable;
    const lines = bill.lines.map((line: unknown, index: number) => {
      const item = object(line);
      const visit = details.visits[index];
      return item && visit && item.date === visit.date && item.minutes === visit.minutes && cents(item.cents) ? { ...visit, cents: item.cents } : null;
    });
    if (lines.some((line) => line === null)) return unavailable;
    return { ok: true, submissionKey: row.submissionKey, bill: { details, lines: lines.filter((line) => line !== null), cents: bill.cents } };
  } catch (error) {
    if (error instanceof CaregiverBillError) return unavailable;
    throw error;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function cents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
