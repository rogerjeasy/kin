import type { Agreement } from "./agreement.ts";
import { planApprovals, type ApprovalPlan } from "./approval-plan.ts";
import { assertCents } from "./money.ts";
import { RECEIPT_CATEGORIES, type ReceiptCategory } from "./receipt.ts";
import type { ParentLevel } from "./roles.ts";

/** The purpose key every proposal raised from a bill read from a letter carries. */
export const LETTER_BILL_PURPOSE = "letter_bill";

/** The longest payee name a reviewer may write: the same limit as a letter's sender. */
export const MAX_PAYEE_NAME = 80;
/** The longest PayPal email Kin stores, as PayPal Payouts accepts. */
export const MAX_RECEIVER_EMAIL = 127;

/**
 * What a person confirmed about a bill Kin read from a letter. `receiver` is
 * the payee's PayPal email when the bill is paid through PayPal Payouts, or
 * `null` when the payee takes no PayPal and a member pays it outside Kin.
 */
export type BillReview = {
  readonly name: string;
  readonly cents: number;
  /** YYYY-MM-DD, or `null` when the letter names no day. */
  readonly dueOn: string | null;
  readonly receiver: string | null;
};

/** How a reviewed bill is paid: through PayPal from the pool, or by a member outside Kin, reimbursed by receipt. */
export type BillRoute = "paypal" | "outside";

export class BillReviewError extends Error {
  readonly retryable = false;
  readonly reason: "name" | "amount" | "due" | "receiver";

  constructor(reason: BillReviewError["reason"]) {
    super(`A bill cannot be confirmed as written: ${reason}`);
    this.name = "BillReviewError";
    this.reason = reason;
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Reads a person's review of a bill from untrusted input. */
export function checkBillReview(input: { readonly name: unknown; readonly cents: unknown; readonly dueOn: unknown; readonly receiver: unknown }): BillReview {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name === "" || name.length > MAX_PAYEE_NAME) throw new BillReviewError("name");
  const { cents } = input;
  if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents <= 0) throw new BillReviewError("amount");
  assertCents(cents);
  const dueOn = input.dueOn === null || input.dueOn === "" ? null : input.dueOn;
  if (dueOn !== null && (typeof dueOn !== "string" || !isRealDay(dueOn))) throw new BillReviewError("due");
  return { name, cents, dueOn, receiver: checkReceiver(input.receiver) };
}

function checkReceiver(value: unknown): string | null {
  if (value === null || value === "") return null;
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > MAX_RECEIVER_EMAIL || !EMAIL.test(email)) throw new BillReviewError("receiver");
  return email;
}

export const billRoute = (review: Pick<BillReview, "receiver">): BillRoute => (review.receiver === null ? "outside" : "paypal");

export type BillPaymentRequest = {
  readonly cents: number;
  /** Whether the family has approved this payee before. A new payee is announced to the whole circle. */
  readonly payeeStatus: "approved" | "new";
  /** The member reviewing the bill, who raises the proposal and confirms where the money goes. */
  readonly reviewerMemberId: string;
  readonly agreement: Pick<Agreement, "version" | "approvals">;
  readonly parentLevel: ParentLevel;
  readonly pausedUntil: Date | null;
  readonly now: Date;
};

/**
 * Who must say yes before a reviewed bill is paid from the pool. A bill a
 * person has just reviewed is never paid on a standing rule: the family
 * answers it as the agreement says, so a reading can never pay itself. The
 * payee is a company, never a member, so the plan names no member being paid;
 * the reviewer confirmed where the money goes, so, like a member being paid,
 * their yes alone can never complete it (`interestedMembers`).
 */
export function planBillPayment(request: BillPaymentRequest): ApprovalPlan {
  const plan = planApprovals({
    kind: "bill_payment",
    cents: request.cents,
    payee: { status: request.payeeStatus, member: null, autoPay: null },
    agreement: request.agreement,
    parentLevel: request.parentLevel,
    pausedUntil: request.pausedUntil,
    now: request.now,
  });
  return plan.outcome === "needs_approval" ? { ...plan, raiserMemberId: request.reviewerMemberId } : plan;
}

/** The longest payee name Kin speaks aloud. */
export const MAX_SPOKEN_NAME = 40;
// Letters in any script, their marks, spaces and the punctuation of a company's name; no digits, links or symbols.
const SPEAKABLE = /^[\p{L}\p{M}][\p{L}\p{M} .,'’&-]*$/u;

/**
 * A payee's name as Kin may speak it to the parent, or `null` when it may not.
 * The name came from a letter or was typed, so it is untrusted: anything but
 * letters, spaces and a company's punctuation, or a name longer than
 * `MAX_SPOKEN_NAME`, is never spoken. With no digits, it can carry no amount
 * the number guard did not supply; with no symbols, no link or address.
 */
export function speakableName(name: string): string | null {
  const trimmed = name.normalize("NFC").replace(/\s+/gu, " ").trim();
  return trimmed.length <= MAX_SPOKEN_NAME && SPEAKABLE.test(trimmed) ? trimmed : null;
}

/** The receipt category a bill paid outside Kin is credited under: the payee's, when receipts know it. */
export function outsideReceiptCategory(payeeCategory: string): ReceiptCategory {
  return RECEIPT_CATEGORIES.find((category) => category === payeeCategory) ?? "other";
}

// 2026-02-30 has the right shape and no such day.
function isRealDay(day: string): boolean {
  if (!DAY.test(day)) return false;
  const [year, month, date] = day.split("-").map(Number);
  const parsed = new Date(Date.UTC(year as number, (month as number) - 1, date as number));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === (month as number) - 1 && parsed.getUTCDate() === date;
}
