import { decimalAmount, type Money } from "@kin/domain";

import { moneyOf, parseCapture, type Capture } from "./capture.ts";
import { encodeContributionReference, parseContributionReference, type ContributionReference } from "./contribution-reference.ts";
import { asRecord, optionalRecord, optionalText, recordList, requiredText } from "./json.ts";

/** An order as Kin reads it: who it is for, where it stands, and its captures. */
export type Order = {
  readonly id: string;
  /** PayPal's order status: `CREATED`, `APPROVED`, `COMPLETED` and others. */
  readonly status: string;
  readonly reference: ContributionReference | null;
  readonly amount: Money | null;
  readonly captures: readonly Capture[];
};

export type NewContributionOrder = {
  readonly amount: Money;
  readonly reference: ContributionReference;
  /** What the payer sees on PayPal's page and in their activity. */
  readonly description: string;
  /** Where PayPal returns the payer if it falls back from a popup to a full page. */
  readonly returnUrl: string;
};

/**
 * The one request ID an order's capture is ever sent with, by the web app or
 * the worker, so PayPal captures each order at most once.
 */
export function captureRequestId(orderId: string): string {
  return `kin-capture-${orderId}`;
}

/** The Orders v2 request for a member's top-up: one unit, no shipping, paid at once. */
export function contributionOrderBody(order: NewContributionOrder): string {
  return JSON.stringify({
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: "contribution",
        custom_id: encodeContributionReference(order.reference),
        description: order.description.slice(0, 127),
        amount: { currency_code: order.amount.currency, value: decimalAmount(order.amount) },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "Kin",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: order.returnUrl,
          cancel_url: order.returnUrl,
        },
      },
    },
  });
}

/** Reads an order, with every capture of its first purchase unit. */
export function parseOrder(value: unknown): Order {
  const record = asRecord(value, "order");
  const id = requiredText(record, "id");
  const unit = recordList(record["purchase_units"])[0] ?? null;
  const customId = optionalText(unit, "custom_id");
  const amount = optionalRecord(unit?.["amount"]);
  const captures = recordList(optionalRecord(unit?.["payments"])?.["captures"]).map((capture) => parseCapture(capture, id, customId));
  return {
    id,
    status: requiredText(record, "status"),
    reference: parseContributionReference(customId),
    amount: amount === null ? null : moneyOf(amount, "order amount"),
    captures,
  };
}
