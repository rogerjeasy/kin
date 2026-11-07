import { assertCents } from "./money.ts";

/** What a member's receipt may be filed under. Each is an expense account of the ledger. */
export const RECEIPT_CATEGORIES = ["pharmacy", "groceries", "medical", "household", "transport", "other"] as const;

export type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number];

/** The most one receipt may claim, in cents. Anything bigger is a bill, not a receipt. */
export const MAX_RECEIPT_CENTS = 10_000_000;
export const MAX_RECEIPT_DESCRIPTION = 120;

export type Receipt = {
  readonly category: ReceiptCategory;
  readonly cents: number;
  /** What was bought and where, in the member's words. */
  readonly description: string;
  /** The day it was bought, as YYYY-MM-DD. */
  readonly spentOn: string;
};

/** The receipt cannot be filed as written. Retrying the same receipt cannot help. */
export class ReceiptError extends Error {
  readonly retryable = false;
  readonly reason: "category" | "amount" | "description" | "date";

  constructor(reason: ReceiptError["reason"]) {
    super(`A receipt cannot be filed: ${reason}`);
    this.name = "ReceiptError";
    this.reason = reason;
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads a receipt from untrusted input. `today` is the circle's own date, so
 * a receipt cannot be dated in the future.
 */
export function checkReceipt(input: { readonly category: unknown; readonly cents: unknown; readonly description: unknown; readonly spentOn: unknown }, today: string): Receipt {
  const category = RECEIPT_CATEGORIES.find((each) => each === input.category);
  if (category === undefined) throw new ReceiptError("category");
  const { cents } = input;
  if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_RECEIPT_CENTS) throw new ReceiptError("amount");
  assertCents(cents);
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description === "" || description.length > MAX_RECEIPT_DESCRIPTION) throw new ReceiptError("description");
  const { spentOn } = input;
  if (typeof spentOn !== "string" || !isRealDay(spentOn) || spentOn > today) throw new ReceiptError("date");
  return { category, cents, description, spentOn };
}

// 2026-02-30 and 2026-13-01 have the right shape and no such day.
function isRealDay(day: string): boolean {
  if (!DAY.test(day)) return false;
  const [year, month, date] = day.split("-").map(Number);
  const parsed = new Date(Date.UTC(year as number, (month as number) - 1, date as number));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === (month as number) - 1 && parsed.getUTCDate() === date;
}
