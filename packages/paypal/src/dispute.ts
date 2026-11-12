import type { Money } from "@kin/domain";

import { moneyOf } from "./capture.ts";
import { asRecord, optionalRecord, optionalText, PayPalShapeError, recordList, requiredText } from "./json.ts";

/** PayPal's dispute statuses (Customer Disputes v1, `status`). */
export const DISPUTE_STATUSES = ["OPEN", "WAITING_FOR_BUYER_RESPONSE", "WAITING_FOR_SELLER_RESPONSE", "UNDER_REVIEW", "RESOLVED", "OTHER"] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/** PayPal's dispute reasons (`dispute_reason`). Anything else reads as `OTHER`. */
export const DISPUTE_REASONS = [
  "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
  "UNAUTHORISED",
  "CREDIT_NOT_PROCESSED",
  "DUPLICATE_TRANSACTION",
  "INCORRECT_AMOUNT",
  "PAYMENT_BY_OTHER_MEANS",
  "CANCELED_RECURRING_BILLING",
  "PROBLEM_WITH_REMITTANCE",
  "OTHER",
] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];

const DISPUTE_ID = /^[A-Za-z0-9-]{1,255}$/;

/** Whether `id` has the shape of a PayPal dispute ID, which goes into a URL path. */
export function isDisputeId(id: string): boolean {
  return DISPUTE_ID.test(id);
}

/**
 * A dispute as Kin reads it. Only PayPal's fixed words, the amount and the
 * times: no buyer's message, name or note, which are free text a stranger wrote.
 */
export type Dispute = {
  readonly id: string;
  readonly status: DisputeStatus;
  readonly reason: DisputeReason;
  readonly amount: Money | null;
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
  /** The pool's own transaction IDs the dispute names. A summary from a list names none. */
  readonly sellerTransactionIds: readonly string[];
};

function oneOf<T extends string>(values: readonly T[], value: string | null, otherwise: T): T {
  return values.find((each) => each === value) ?? otherwise;
}

function timeOf(value: string | null): Date | null {
  if (value === null) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time;
}

/** One dispute, from a list's summary or from the dispute read by its ID. */
export function parseDispute(value: unknown): Dispute {
  const record = asRecord(value, "dispute");
  const id = requiredText(record, "dispute_id");
  if (!isDisputeId(id)) throw new PayPalShapeError("dispute id");
  const amount = optionalRecord(record["dispute_amount"]);
  return {
    id,
    status: oneOf(DISPUTE_STATUSES, optionalText(record, "status"), "OTHER"),
    reason: oneOf(DISPUTE_REASONS, optionalText(record, "reason"), "OTHER"),
    amount: amount === null ? null : moneyOf(amount, "dispute amount"),
    createdAt: timeOf(optionalText(record, "create_time")),
    updatedAt: timeOf(optionalText(record, "update_time")),
    sellerTransactionIds: recordList(record["disputed_transactions"]).flatMap((transaction) => optionalText(transaction, "seller_transaction_id") ?? []),
  };
}

/** The disputes of a list (`GET /v1/customer/disputes`). */
export function parseDisputeList(value: unknown): Dispute[] {
  return recordList(asRecord(value, "dispute list")["items"]).map(parseDispute);
}
