import type { Money } from "@kin/domain";

import { parseCapture, type Capture } from "./capture.ts";
import type { PayPalClient } from "./client.ts";
import { contributionOrderBody, parseOrder, type NewContributionOrder, type Order } from "./order.ts";
import { cancelBody, invoiceBody, isInvoiceId, numberSearchBody, parseInvoice, parseInvoiceCreated, parseNumberSearch, SEND_BODY, type Invoice, type NewInvoice } from "./invoice.ts";
import { requiredText, asRecord, PayPalShapeError } from "./json.ts";
import { PayPalError } from "./paypal-error.ts";
import { parseRefund, type Refund } from "./refund.ts";
import { parsePayoutBatch, parsePayoutCreated, payoutBody, type NewPayout, type PayoutBatch } from "./payout.ts";
import {
  actionBody,
  circleProductId,
  isSubscriptionId,
  parseCreatedId,
  parseSubscription,
  parseSubscriptionCreated,
  parsePlan,
  parseSubscriptionPayments,
  parseSubscriptionPlanId,
  parseSubscriptionRevised,
  planBody,
  productBody,
  reviseBody,
  subscriptionBody,
  type NewSubscription,
  type Subscription,
  type SubscriptionAction,
  type SubscriptionPayment,
} from "./subscription.ts";
import { parsePayoutItemTransactionId, searchTransaction, type TransactionRecord } from "./transaction-search.ts";
import { parseVerification, verificationBody, type WebhookDelivery } from "./webhook.ts";

/**
 * The PayPal account that holds a circle's shared money, and the business
 * actions Kin takes on it. Web and worker depend on this interface; tests use
 * `fakePool` from `@kin/paypal/testing`.
 */
export type PayPalPool = {
  readonly createOrder: (order: NewContributionOrder, requestId: string) => Promise<{ readonly orderId: string }>;
  readonly getOrder: (orderId: string) => Promise<Order>;
  /** Captures an approved order. PayPal's answer is never taken as proof the money arrived. */
  readonly captureOrder: (orderId: string, requestId: string) => Promise<Order>;
  readonly getCapture: (captureId: string) => Promise<Capture>;
  /** Reads a refund of a capture back from PayPal: what went back to the payer, and the part of the fee PayPal returned. */
  readonly getRefund: (refundId: string) => Promise<Refund>;
  /** Asks PayPal whether a delivery really came from it, for this pool's webhook. */
  readonly verifyWebhook: (delivery: WebhookDelivery) => Promise<boolean>;
  /**
   * Sends one payout from the pool. Sent again with the same request ID and
   * batch ID, PayPal answers with the batch it made and pays nothing twice.
   * Its answer is never proof the recipient was paid: read the batch.
   */
  readonly createPayout: (payout: NewPayout, requestId: string) => Promise<{ readonly batchId: string }>;
  readonly getPayoutBatch: (batchId: string) => Promise<PayoutBatch>;
  /**
   * PayPal's own Transaction Search record of one payout item: the proof that
   * the money left the pool's account. `null` while PayPal has no transaction
   * for the item yet (its search lags by up to three hours). Read only.
   */
  readonly getPayoutTransaction: (payoutItemId: string, around: Date) => Promise<TransactionRecord | null>;
  /**
   * Makes a monthly subscription for a member's share: the circle's product,
   * a plan for the amount, and the subscription the payer then approves on
   * PayPal's page. The circle's product carries Kin's own ID, so it is made
   * once; the plan's request ID is `key` (the subscription's own row ID), so a
   * repeat makes no second plan. The subscription's request ID is `key` too,
   * but PayPal's sandbox made a second subscription for a repeated one (11
   * November 2026): a repeat can leave an unapproved subscription whose link
   * nobody holds, which charges nothing. Nothing is charged until the payer
   * approves.
   */
  readonly createSubscription: (subscription: NewSubscription, key: string) => Promise<{ readonly subscriptionId: string; readonly approvalUrl: string }>;
  readonly getSubscription: (subscriptionId: string) => Promise<Subscription>;
  /**
   * The charges PayPal completed for a subscription between two moments.
   * PayPal answers 404 for a subscription the payer has not approved yet.
   */
  readonly listSubscriptionPayments: (subscriptionId: string, from: Date, until: Date) => Promise<readonly SubscriptionPayment[]>;
  /**
   * Pauses, resumes or ends a subscription. PayPal takes no request ID here:
   * asked twice, it refuses the second (422 `SUBSCRIPTION_STATUS_INVALID`), so
   * read the subscription back to learn where it stands. `requestId` names the
   * ask for the fake pool's record and is not sent.
   */
  readonly changeSubscription: (subscriptionId: string, action: SubscriptionAction, reason: string, requestId: string) => Promise<void>;
  /**
   * Revises a live subscription to a new monthly amount. PayPal asks the
   * payer to approve the new price on the page it returns; the old amount
   * runs until they do. PayPal takes no request ID here; `requestId` names
   * the ask for the fake pool's record and is not sent.
   */
  readonly reviseSubscription: (subscriptionId: string, amount: Money, returnUrl: string, requestId: string) => Promise<{ readonly approvalUrl: string | null }>;
  /**
   * Makes a draft invoice from the pool to a member. It asks nothing of
   * anyone until it is sent. The invoice's number is its idempotency key: a
   * repeat finds the draft the first call made, never a second one.
   */
  readonly createInvoice: (invoice: NewInvoice, requestId: string) => Promise<{ readonly invoiceId: string }>;
  /** Has PayPal email a draft to its recipient. Its answer says nothing about payment: read the invoice. */
  readonly sendInvoice: (invoiceId: string, requestId: string) => Promise<void>;
  /** The invoice as PayPal holds it now, with every payment listed on it. */
  readonly getInvoice: (invoiceId: string) => Promise<Invoice>;
  /** Withdraws a sent invoice; PayPal tells the recipient. */
  readonly cancelInvoice: (invoiceId: string, note: string, requestId: string) => Promise<void>;
};

const ORDER_ID = /^[A-Z0-9]{5,36}$/;

/** The pool's actions over a signed-in client, with the pool's webhook ID. */
export function paypalPool(client: PayPalClient, webhookId: string): PayPalPool {
  return {
    async createOrder(order, requestId) {
      const json = await client.send({ method: "POST", path: "/v2/checkout/orders", body: contributionOrderBody(order), requestId, operation: "orders.create" });
      return { orderId: requiredText(asRecord(json, "order"), "id") };
    },
    async getOrder(orderId) {
      return parseOrder(await client.send({ method: "GET", path: `/v2/checkout/orders/${pathId(orderId)}`, operation: "orders.get" }));
    },
    async captureOrder(orderId, requestId) {
      return parseOrder(await client.send({ method: "POST", path: `/v2/checkout/orders/${pathId(orderId)}/capture`, body: "{}", requestId, operation: "orders.capture" }));
    },
    async getCapture(captureId) {
      return parseCapture(await client.send({ method: "GET", path: `/v2/payments/captures/${pathId(captureId)}`, operation: "captures.get" }));
    },
    async getRefund(refundId) {
      return parseRefund(await client.send({ method: "GET", path: `/v2/payments/refunds/${pathId(refundId)}`, operation: "refunds.get" }));
    },
    async createPayout(payout, requestId) {
      try {
        return parsePayoutCreated(await client.send({ method: "POST", path: "/v1/payments/payouts", body: payoutBody(payout), requestId, operation: "payouts.create" }));
      } catch (error) {
        // PayPal refuses a batch ID it has paid before, and links the batch it
        // made then (seen in the sandbox on 26 October 2026). That batch is the
        // answer a lost reply would have carried.
        const batchId = error instanceof PayPalError ? existingBatch(error) : null;
        if (batchId === null) throw error;
        return { batchId };
      }
    },
    async getPayoutBatch(batchId) {
      return parsePayoutBatch(await client.send({ method: "GET", path: `/v1/payments/payouts/${pathId(batchId)}`, operation: "payouts.get" }));
    },
    async getPayoutTransaction(payoutItemId, around) {
      const item = await client.send({ method: "GET", path: `/v1/payments/payouts-item/${pathId(payoutItemId)}`, operation: "payouts.item" });
      const transactionId = parsePayoutItemTransactionId(item);
      return transactionId === null ? null : searchTransaction(client, { transactionId, around });
    },
    async createSubscription(subscription, key) {
      const productId = await circleProduct(client, subscription);
      const planId = parseCreatedId(
        await client.send({ method: "POST", path: "/v1/billing/plans", body: planBody(productId, subscription.description, subscription.amount), requestId: `kin-plan-${key}`, operation: "plans.create" }),
        "plan",
      );
      return parseSubscriptionCreated(
        await client.send({ method: "POST", path: "/v1/billing/subscriptions", body: subscriptionBody(planId, subscription), requestId: `kin-subscription-${key}`, operation: "subscriptions.create" }),
      );
    },
    async getSubscription(subscriptionId) {
      return parseSubscription(await client.send({ method: "GET", path: `/v1/billing/subscriptions/${subscriptionPathId(subscriptionId)}`, operation: "subscriptions.get" }));
    },
    async listSubscriptionPayments(subscriptionId, from, until) {
      const window = `start_time=${encodeURIComponent(from.toISOString())}&end_time=${encodeURIComponent(until.toISOString())}`;
      return parseSubscriptionPayments(
        await client.send({ method: "GET", path: `/v1/billing/subscriptions/${subscriptionPathId(subscriptionId)}/transactions?${window}`, operation: "subscriptions.transactions" }),
      );
    },
    // Subscriptions v1 lists `PayPal-Request-Id` on create only; suspend, activate, cancel and revise take
    // none (PayPal's OpenAPI document, read 11 November 2026), so none is sent. A repeat is refused, not
    // recognised (422 SUBSCRIPTION_STATUS_INVALID in the sandbox), and callers read the subscription back.
    async changeSubscription(subscriptionId, action, reason) {
      await client.send({ method: "POST", path: `/v1/billing/subscriptions/${subscriptionPathId(subscriptionId)}/${action}`, body: actionBody(reason), operation: `subscriptions.${action}` });
    },
    async reviseSubscription(subscriptionId, amount, returnUrl) {
      // PayPal revises a subscription onto another plan, never a new price on its own: Kin makes a sibling plan
      // for the amount, on the same product. Its request ID names the subscription and the amount, so a repeat
      // makes no second plan.
      const path = `/v1/billing/subscriptions/${subscriptionPathId(subscriptionId)}`;
      const currentPlanId = parseSubscriptionPlanId(await client.send({ method: "GET", path, operation: "subscriptions.get" }));
      const current = parsePlan(await client.send({ method: "GET", path: `/v1/billing/plans/${currentPlanId}`, operation: "plans.get" }));
      const planId = parseCreatedId(
        await client.send({ method: "POST", path: "/v1/billing/plans", body: planBody(current.productId, current.name, amount), requestId: `kin-plan-${subscriptionId}-${amount.currency}-${amount.cents}`, operation: "plans.create" }),
        "plan",
      );
      const revised = parseSubscriptionRevised(
        await client.send({ method: "POST", path: `${path}/revise`, body: reviseBody(planId, returnUrl), operation: "subscriptions.revise" }),
      );
      return { approvalUrl: revised.approvalUrl };
    },
    async createInvoice(invoice, requestId) {
      try {
        return { invoiceId: parseInvoiceCreated(await client.send({ method: "POST", path: "/v2/invoicing/invoices", body: invoiceBody(invoice), requestId, operation: "invoices.create" })) };
      } catch (error) {
        // PayPal holds an invoice with this number already: the one an earlier,
        // unanswered call made. It is found by its number, not made again.
        if (!(error instanceof PayPalError) || error.outcome !== "rejected" || error.issue !== "DUPLICATE_INVOICE_NUMBER") throw error;
        const found = await client.send({ method: "POST", path: "/v2/invoicing/search-invoices?page=1&page_size=2", body: numberSearchBody(invoice.number), operation: "invoices.search" });
        return { invoiceId: parseNumberSearch(found, invoice.number) };
      }
    },
    async sendInvoice(invoiceId, requestId) {
      await client.send({ method: "POST", path: `/v2/invoicing/invoices/${invoicePathId(invoiceId)}/send`, body: SEND_BODY, requestId, operation: "invoices.send" });
    },
    async getInvoice(invoiceId) {
      return parseInvoice(await client.send({ method: "GET", path: `/v2/invoicing/invoices/${invoicePathId(invoiceId)}`, operation: "invoices.get" }));
    },
    async cancelInvoice(invoiceId, note, requestId) {
      await client.send({ method: "POST", path: `/v2/invoicing/invoices/${invoicePathId(invoiceId)}/cancel`, body: cancelBody(note), requestId, operation: "invoices.cancel" });
    },
    async verifyWebhook(delivery) {
      try {
        const json = await client.send({ method: "POST", path: "/v1/notifications/verify-webhook-signature", body: verificationBody(delivery, webhookId), operation: "webhooks.verify" });
        return parseVerification(json);
      } catch (error) {
        // PayPal refusing to check a delivery (malformed headers or event) is
        // a no. Only an outage is thrown, so the delivery is tried again.
        if (error instanceof PayPalError && error.outcome === "rejected") return false;
        throw error;
      }
    },
  };
}

/** The circle's one product: made the first time, and found by its own ID every time after. */
async function circleProduct(client: PayPalClient, subscription: NewSubscription): Promise<string> {
  const productId = circleProductId(subscription.reference.circleId);
  try {
    const made = parseCreatedId(
      await client.send({ method: "POST", path: "/v1/catalogs/products", body: productBody(productId, subscription.description), requestId: `kin-product-${subscription.reference.circleId}`, operation: "products.create" }),
      "product",
    );
    if (made !== productId) throw new PayPalShapeError("product id");
    return made;
  } catch (error) {
    if (error instanceof PayPalError && error.outcome === "rejected" && error.issue === "DUPLICATE_RESOURCE_IDENTIFIER") return productId;
    throw error;
  }
}

const EXISTING_BATCH =/\/v1\/payments\/payouts\/([A-Z0-9]{5,36})$/;

function existingBatch(error: PayPalError): string | null {
  if (error.outcome !== "rejected" || error.status !== 400 || error.resource === null) return null;
  return EXISTING_BATCH.exec(error.resource)?.[1] ?? null;
}

/** Whether `id` has the shape of a PayPal order or capture ID. */
export function isPayPalId(id: string): boolean {
  return ORDER_ID.test(id);
}

function invoicePathId(id: string): string {
  if (!isInvoiceId(id)) throw new Error("Not a PayPal invoice ID");
  return id;
}

function subscriptionPathId(id: string): string {
  if (!isSubscriptionId(id)) throw new Error("Not a PayPal subscription ID");
  return id;
}

// An ID goes into a URL path, so anything but PayPal's own alphabet is refused.
function pathId(id: string): string {
  if (!isPayPalId(id)) throw new Error("Not a PayPal resource ID");
  return id;
}
