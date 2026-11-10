import type { Money } from "@kin/domain";

import { moneyOf } from "./capture.ts";
import { asRecord, optionalRecord, optionalText, recordList, requiredText, PayPalShapeError, type JsonRecord } from "./json.ts";

/** PayPal's refund statuses. Only `COMPLETED` means the money went back to the payer. */
export type RefundStatus = "COMPLETED" | "PENDING" | "FAILED" | "CANCELLED";

/**
 * A refund of one capture, as Kin reads it back from PayPal
 * (`GET /v2/payments/refunds/{id}`): money that went from the pool back to
 * the payer. A refund names the capture it returns only through its `up` link.
 */
export type Refund = {
  readonly id: string;
  readonly status: RefundStatus | "OTHER";
  /** The capture it refunds, from the refund's `up` link, or `null` when PayPal links none. */
  readonly captureId: string | null;
  /** What went back to the payer. */
  readonly gross: Money;
  /** The part of the capture's fee PayPal gave back to the pool. Zero when PayPal kept the whole fee, or did not say. */
  readonly feeReturned: Money;
  /** What left the pool's balance, when PayPal states it: the gross, less the fee it gave back, less any platform fee. */
  readonly net: Money | null;
  /** Everything refunded from the capture so far, this refund included, when PayPal states it. */
  readonly totalRefunded: Money | null;
  readonly createdAt: Date;
};

const STATUSES: readonly RefundStatus[] = ["COMPLETED", "PENDING", "FAILED", "CANCELLED"];

// PayPal's resource IDs, as pool.ts holds them. A link to anything else names no capture.
const CAPTURE_LINK = /\/v2\/payments\/captures\/([A-Z0-9]{5,36})$/;

/**
 * Reads a refund from PayPal's JSON, the body of a refund event's resource or
 * of the refund read back. Amounts are parsed from PayPal's decimal strings
 * into integer cents digit by digit, never through a float.
 */
export function parseRefund(value: unknown): Refund {
  const record = asRecord(value, "refund");
  const breakdown = optionalRecord(record["seller_payable_breakdown"]);
  const grossRecord = optionalRecord(breakdown?.["gross_amount"]) ?? asRecord(record["amount"], "refund amount");
  const gross = moneyOf(grossRecord, "refund amount");
  const fee = optionalMoney(breakdown, "paypal_fee", "refund fee") ?? { cents: 0, currency: gross.currency };
  const net = optionalMoney(breakdown, "net_amount", "refund net amount");
  const totalRefunded = optionalMoney(breakdown, "total_refunded_amount", "total refunded");
  for (const each of [fee, net, totalRefunded]) {
    if (each !== null && each.currency !== gross.currency) throw new PayPalShapeError("refund amounts in one currency");
  }
  const status = requiredText(record, "status");
  const createdAt = new Date(requiredText(record, "create_time"));
  if (Number.isNaN(createdAt.getTime())) throw new PayPalShapeError("refund time");
  return {
    id: requiredText(record, "id"),
    status: STATUSES.find((each) => each === status) ?? "OTHER",
    captureId: refundedCaptureId(record),
    gross,
    feeReturned: fee,
    net,
    totalRefunded,
    createdAt,
  };
}

/** The capture a refund's `up` link points to, or `null`. */
export function refundedCaptureId(refund: JsonRecord | null): string | null {
  const up = recordList(refund?.["links"]).find((link) => optionalText(link, "rel") === "up");
  const href = optionalText(up ?? null, "href");
  if (href === null) return null;
  let path: string;
  try {
    path = new URL(href).pathname;
  } catch {
    return null;
  }
  return CAPTURE_LINK.exec(path)?.[1] ?? null;
}

function optionalMoney(breakdown: JsonRecord | null, key: string, what: string): Money | null {
  const record = optionalRecord(breakdown?.[key]);
  return record === null ? null : moneyOf(record, what);
}
