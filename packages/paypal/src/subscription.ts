import { decimalAmount, type MonthlyShareState, type Money } from "@kin/domain";

import { moneyOf } from "./capture.ts";
import { encodeContributionReference, parseContributionReference, type ContributionReference } from "./contribution-reference.ts";
import { asRecord, optionalRecord, optionalText, PayPalShapeError, recordList, requiredText } from "./json.ts";

/** PayPal's subscription statuses. Anything else reads as `OTHER`. */
export type SubscriptionStatus = "APPROVAL_PENDING" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "EXPIRED" | "OTHER";

const STATUSES: readonly Exclude<SubscriptionStatus, "OTHER">[] = ["APPROVAL_PENDING", "APPROVED", "ACTIVE", "SUSPENDED", "CANCELLED", "EXPIRED"];

/** A subscription as Kin reads it from PayPal: whose it is, where it stands, and how its charges have gone. */
export type Subscription = {
  readonly id: string;
  readonly status: SubscriptionStatus;
  readonly reference: ContributionReference | null;
  readonly nextBillingAt: Date | null;
  readonly failedPayments: number;
};

/** One charge PayPal took for a subscription. Only a `COMPLETED` one is money that arrived. */
export type SubscriptionPayment = {
  readonly id: string;
  readonly gross: Money;
  /** PayPal's fee, or zero while PayPal has not charged one. */
  readonly fee: Money;
  readonly paidAt: Date;
};

export type NewSubscription = {
  readonly amount: Money;
  readonly reference: ContributionReference;
  /** What the payer sees on PayPal's page. */
  readonly description: string;
  /** Where PayPal returns the payer after approving or cancelling. */
  readonly returnUrl: string;
};

/** What a person may do to a live subscription. */
export const SUBSCRIPTION_ACTIONS = ["suspend", "activate", "cancel"] as const;
export type SubscriptionAction = (typeof SUBSCRIPTION_ACTIONS)[number];

/**
 * The state a member's share takes from PayPal's word, or `null` for a status
 * Kin does not map (it is left as it was). An approved subscription has not
 * charged yet, so it still waits.
 */
export function shareStateOf(status: SubscriptionStatus): MonthlyShareState | null {
  switch (status) {
    case "APPROVAL_PENDING":
    case "APPROVED":
      return "approval_pending";
    case "ACTIVE":
      return "active";
    case "SUSPENDED":
      return "paused";
    case "CANCELLED":
    case "EXPIRED":
      return "cancelled";
    case "OTHER":
      return null;
  }
}

const SUBSCRIPTION_ID = /^I-[A-Z0-9]{6,34}$/;

/** Whether `id` has the shape of a PayPal subscription ID, which goes into URL paths. */
export function isSubscriptionId(id: string): boolean {
  return SUBSCRIPTION_ID.test(id);
}

/** The one Catalog product a circle's subscriptions are plans of. */
export function productBody(name: string): string {
  return JSON.stringify({ name: name.slice(0, 127), description: "A family's shared care fund, managed with Kin", type: "SERVICE" });
}

/** A plan that charges `amount` every month with no end date, and retries a failed charge three times. */
export function planBody(productId: string, name: string, amount: Money): string {
  return JSON.stringify({
    product_id: productId,
    name: name.slice(0, 127),
    status: "ACTIVE",
    billing_cycles: [
      {
        frequency: { interval_unit: "MONTH", interval_count: 1 },
        tenure_type: "REGULAR",
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: { fixed_price: { value: decimalAmount(amount), currency_code: amount.currency } },
      },
    ],
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
  });
}

/** The subscription request. Its `custom_id` names the circle and member, like a top-up order's. */
export function subscriptionBody(planId: string, subscription: NewSubscription): string {
  return JSON.stringify({
    plan_id: planId,
    custom_id: encodeContributionReference(subscription.reference),
    application_context: {
      brand_name: "Kin",
      shipping_preference: "NO_SHIPPING",
      user_action: "SUBSCRIBE_NOW",
      return_url: subscription.returnUrl,
      cancel_url: subscription.returnUrl,
    },
  });
}

/** The body of a suspend, activate or cancel call: PayPal wants a reason, which the payer sees. */
export function actionBody(reason: string): string {
  return JSON.stringify({ reason: reason.slice(0, 128) });
}

export function parseCreatedId(value: unknown, what: string): string {
  return requiredText(asRecord(value, what), "id");
}

/** The ID of a created subscription and the PayPal page where its payer approves it. */
export function parseSubscriptionCreated(value: unknown): { readonly subscriptionId: string; readonly approvalUrl: string } {
  const record = asRecord(value, "subscription");
  const subscriptionId = requiredText(record, "id");
  if (!isSubscriptionId(subscriptionId)) throw new PayPalShapeError("subscription id");
  const approve = recordList(record["links"]).find((link) => link["rel"] === "approve");
  const href = approve === undefined ? null : optionalText(approve, "href");
  const approvalUrl = href === null ? null : paypalPage(href);
  if (approvalUrl === null) throw new PayPalShapeError("approval link");
  return { subscriptionId, approvalUrl };
}

/** The address only if it is a PayPal page over HTTPS: a link the browser will be sent to. */
export function paypalPage(href: string): string | null {
  try {
    const url = new URL(href);
    const host = url.hostname;
    return url.protocol === "https:" && (host === "paypal.com" || host.endsWith(".paypal.com")) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseSubscription(value: unknown): Subscription {
  const record = asRecord(value, "subscription");
  const status = requiredText(record, "status");
  const billing = optionalRecord(record["billing_info"]);
  const failed = billing?.["failed_payments_count"];
  const next = optionalText(billing, "next_billing_time");
  const nextBillingAt = next === null ? null : new Date(next);
  return {
    id: requiredText(record, "id"),
    status: STATUSES.find((each) => each === status) ?? "OTHER",
    reference: parseContributionReference(optionalText(record, "custom_id")),
    nextBillingAt: nextBillingAt === null || Number.isNaN(nextBillingAt.getTime()) ? null : nextBillingAt,
    failedPayments: typeof failed === "number" && Number.isSafeInteger(failed) && failed >= 0 ? failed : 0,
  };
}

/** The completed charges in a transaction listing. Pending, failed and refunded ones are not money that arrived. */
export function parseSubscriptionPayments(value: unknown): SubscriptionPayment[] {
  const payments: SubscriptionPayment[] = [];
  for (const transaction of recordList(asRecord(value, "subscription transactions")["transactions"])) {
    if (optionalText(transaction, "status") !== "COMPLETED") continue;
    const breakdown = asRecord(transaction["amount_with_breakdown"], "transaction amounts");
    const gross = moneyOf(asRecord(breakdown["gross_amount"], "transaction gross"), "transaction gross");
    const feeRecord = optionalRecord(breakdown["fee_amount"]);
    const fee = feeRecord === null ? { cents: 0, currency: gross.currency } : moneyOf(feeRecord, "transaction fee");
    if (fee.currency !== gross.currency) throw new PayPalShapeError("transaction fee in the charge's currency");
    const paidAt = new Date(requiredText(transaction, "time"));
    if (Number.isNaN(paidAt.getTime())) throw new PayPalShapeError("transaction time");
    payments.push({ id: requiredText(transaction, "id"), gross, fee, paidAt });
  }
  return payments;
}
