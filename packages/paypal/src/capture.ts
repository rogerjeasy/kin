import { centsFromDecimal, type Money } from "@kin/domain";

import { parseContributionReference, type ContributionReference } from "./contribution-reference.ts";
import { asRecord, optionalRecord, optionalText, requiredText, type JsonRecord, PayPalShapeError } from "./json.ts";

/** PayPal's capture statuses. Only `COMPLETED` means the money arrived. */
export type CaptureStatus = "COMPLETED" | "PENDING" | "DECLINED" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";

/** A capture as Kin reads it: money taken from a payer into the pool. */
export type Capture = {
  readonly id: string;
  readonly status: CaptureStatus | "OTHER";
  /** The order it captured, when PayPal names it. */
  readonly orderId: string | null;
  readonly reference: ContributionReference | null;
  /** The PayPal invoice it paid, when the payer paid one of Kin's invoices. */
  readonly invoiceId: string | null;
  /** What the payer paid. */
  readonly gross: Money;
  /** PayPal's fee, or zero while PayPal has not charged one. */
  readonly fee: Money;
  readonly createdAt: Date;
};

const STATUSES: readonly CaptureStatus[] = ["COMPLETED", "PENDING", "DECLINED", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"];

/**
 * Reads a capture from PayPal's JSON. Amounts are parsed from PayPal's decimal
 * strings into integer cents digit by digit, never through a float.
 */
export function parseCapture(value: unknown, orderId: string | null = null, fallbackCustomId: string | null = null): Capture {
  const record = asRecord(value, "capture");
  const amount = asRecord(record["amount"], "capture amount");
  const gross = moneyOf(amount, "capture amount");
  const breakdown = optionalRecord(record["seller_receivable_breakdown"]);
  const feeRecord = optionalRecord(breakdown?.["paypal_fee"]);
  const fee = feeRecord === null ? { cents: 0, currency: gross.currency } : moneyOf(feeRecord, "capture fee");
  if (fee.currency !== gross.currency) throw new PayPalShapeError("capture fee in the capture's currency");
  const status = requiredText(record, "status");
  const related = optionalRecord(optionalRecord(record["supplementary_data"])?.["related_ids"]);
  const createdAt = new Date(requiredText(record, "create_time"));
  if (Number.isNaN(createdAt.getTime())) throw new PayPalShapeError("capture time");
  return {
    id: requiredText(record, "id"),
    status: STATUSES.find((each) => each === status) ?? "OTHER",
    orderId: optionalText(related, "order_id") ?? orderId,
    reference: parseContributionReference(optionalText(record, "custom_id") ?? fallbackCustomId),
    invoiceId: optionalText(record, "invoice_id"),
    gross,
    fee,
    createdAt,
  };
}

/** An amount PayPal sent as `{ currency_code, value }`, in integer cents. */
export function moneyOf(record: JsonRecord, what: string): Money {
  const currency = requiredText(record, "currency_code");
  try {
    return { cents: centsFromDecimal(requiredText(record, "value"), currency), currency };
  } catch {
    throw new PayPalShapeError(what);
  }
}
