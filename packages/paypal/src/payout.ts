import { centsFromDecimal, decimalAmount, type Money } from "@kin/domain";

import { asRecord, optionalRecord, optionalText, PayPalShapeError, recordList, requiredText, type JsonRecord } from "./json.ts";

/**
 * PayPal's payout item statuses (Payouts v1, `transaction_enum`). Only
 * `SUCCESS` means the recipient has the money.
 */
export const PAYOUT_ITEM_STATUSES = ["SUCCESS", "FAILED", "PENDING", "UNCLAIMED", "RETURNED", "ONHOLD", "BLOCKED", "REFUNDED", "REVERSED"] as const;
export type PayoutItemStatus = (typeof PAYOUT_ITEM_STATUSES)[number];

/** What a payout item's status means for Kin's execution (docs/architecture.md section 8.5). */
export type PayoutOutcome = "confirmed" | "waiting" | "failed";

export type NewPayout = {
  /** The execution's idempotency key. PayPal pays one batch ID at most once in 30 days. */
  readonly senderBatchId: string;
  /** The recipient's PayPal email address. */
  readonly receiver: string;
  readonly amount: Money;
  /** What the recipient reads with the money. */
  readonly note: string;
};

export type PayoutItem = {
  readonly itemId: string;
  readonly status: PayoutItemStatus | "OTHER";
  readonly transactionId: string | null;
  readonly amount: Money;
  /** PayPal's fee for this item, once it has charged one. */
  readonly fee: Money | null;
  readonly senderItemId: string | null;
};

export type PayoutBatch = {
  readonly batchId: string;
  /** `DENIED`, `PENDING`, `PROCESSING`, `SUCCESS` or `CANCELED`. */
  readonly batchStatus: string;
  readonly senderBatchId: string | null;
  readonly items: readonly PayoutItem[];
};

/** The one-item batch that pays an approved proposal. */
export function payoutBody(payout: NewPayout): string {
  return JSON.stringify({
    sender_batch_header: {
      sender_batch_id: payout.senderBatchId,
      recipient_type: "EMAIL",
      email_subject: "You have a payment from Kin",
      email_message: payout.note.slice(0, 1000),
    },
    items: [
      {
        recipient_type: "EMAIL",
        receiver: payout.receiver,
        amount: { currency: payout.amount.currency, value: decimalAmount(payout.amount) },
        note: payout.note.slice(0, 1000),
        sender_item_id: payout.senderBatchId,
      },
    ],
  });
}

/** The batch ID PayPal answered a new payout with. */
export function parsePayoutCreated(value: unknown): { readonly batchId: string } {
  const header = asRecord(asRecord(value, "payout").batch_header, "payout batch header");
  return { batchId: requiredText(header, "payout_batch_id") };
}

/** Reads a payout batch with its items, amounts in integer cents. */
export function parsePayoutBatch(value: unknown): PayoutBatch {
  const record = asRecord(value, "payout batch");
  const header = asRecord(record["batch_header"], "payout batch header");
  return {
    batchId: requiredText(header, "payout_batch_id"),
    batchStatus: requiredText(header, "batch_status"),
    senderBatchId: optionalText(optionalRecord(header["sender_batch_header"]), "sender_batch_id"),
    items: recordList(record["items"]).map(parseItem),
  };
}

/**
 * Where an item stands for Kin. Unclaimed money stays at PayPal until the
 * recipient claims it, and held money waits for PayPal, so both wait.
 */
export function payoutOutcome(status: PayoutItem["status"]): PayoutOutcome {
  switch (status) {
    case "SUCCESS":
      return "confirmed";
    case "PENDING":
    case "UNCLAIMED":
    case "ONHOLD":
    case "OTHER":
      return "waiting";
    case "FAILED":
    case "RETURNED":
    case "BLOCKED":
    case "REFUNDED":
    case "REVERSED":
      return "failed";
  }
}

function parseItem(item: JsonRecord): PayoutItem {
  const detail = asRecord(item["payout_item"], "payout item detail");
  const status = optionalText(item, "transaction_status");
  const fee = optionalRecord(item["payout_item_fee"]);
  return {
    itemId: requiredText(item, "payout_item_id"),
    status: PAYOUT_ITEM_STATUSES.find((each) => each === status) ?? "OTHER",
    transactionId: optionalText(item, "transaction_id"),
    amount: payoutMoney(asRecord(detail["amount"], "payout amount")),
    fee: fee === null ? null : payoutMoney(fee),
    senderItemId: optionalText(detail, "sender_item_id"),
  };
}

// Payouts write money as { currency, value }, unlike Orders' currency_code.
function payoutMoney(record: JsonRecord): Money {
  const currency = requiredText(record, "currency");
  try {
    return { cents: centsFromDecimal(requiredText(record, "value"), currency), currency };
  } catch {
    throw new PayPalShapeError("payout amount");
  }
}
