import type { Money } from "@kin/domain";
import { randomBytes } from "node:crypto";

import type { Capture, CaptureStatus } from "../capture.ts";
import { encodeContributionReference, type ContributionReference } from "../contribution-reference.ts";
import type { Invoice, InvoicePayment, InvoiceStatus, NewInvoice } from "../invoice.ts";
import type { Order } from "../order.ts";
import { PayPalError } from "../paypal-error.ts";
import type { PayPalPool } from "../pool.ts";
import type { TransactionRecord } from "../transaction-search.ts";
import { payoutBody, type NewPayout, type PayoutBatch, type PayoutItemStatus } from "../payout.ts";
import type { Subscription, SubscriptionAction, SubscriptionPayment, SubscriptionStatus } from "../subscription.ts";
import type { WebhookDelivery } from "../webhook.ts";

type StoredOrder = { id: string; status: string; reference: ContributionReference; amount: Money; captures: Capture[]; requestIds: Set<string> };
type StoredPayout = { batch: PayoutBatch; request: NewPayout };
type StoredInvoice = { id: string; number: string; status: InvoiceStatus; request: NewInvoice; payments: InvoicePayment[]; requestIds: Set<string> };
type StoredSubscription = { id: string; key: string; status: SubscriptionStatus; reference: ContributionReference; amount: Money; payments: SubscriptionPayment[]; failedPayments: number; requestIds: Set<string>; revisions?: Money[] };

export type FakePool = PayPalPool & {
  /** The payer approves the order on PayPal's page. */
  readonly approve: (orderId: string) => void;
  /** PayPal's fee on each capture, in cents. */
  feeCents: number;
  /** The status PayPal gives the next captures, such as `DECLINED` for a refused card. */
  captureStatus: CaptureStatus;
  /** Whether `verifyWebhook` says a delivery is genuine. */
  signaturesValid: boolean;
  /** Every request ID a write was sent with, in order. */
  readonly requestIds: string[];
  /** A delivery of PAYMENT.CAPTURE.COMPLETED for a capture, as PayPal would send it. */
  readonly completedEvent: (captureId: string, eventId?: string) => WebhookDelivery;
  readonly orders: Map<string, StoredOrder>;
  /** The next call to this method fails as PayPal being unreachable would. */
  failNext: keyof PayPalPool | null;
  /** The next call to this method takes effect at PayPal, but its answer is lost on the way back. */
  loseNextReply: keyof PayPalPool | null;
  /** PayPal refuses the next payout with this issue, such as `INSUFFICIENT_FUNDS`, and makes nothing. */
  refuseNextPayout: string | null;
  /** The status PayPal gives the next payouts' items, Venmo ones included. */
  payoutStatus: PayoutItemStatus;
  /** PayPal's fee on each successful payout item, in cents. */
  payoutFeeCents: number;
  /** Every payout PayPal made, by batch ID. A repeated request makes none. */
  readonly payouts: Map<string, StoredPayout>;
  /** What Transaction Search says about each payout item, by item ID. An item with no entry has no transaction yet. */
  readonly payoutTransactions: Map<string, TransactionRecord>;
  /** PayPal moves a payout's item on, as it does after a pending or unclaimed payout. */
  readonly settlePayout: (batchId: string, status: PayoutItemStatus) => void;
  /** Every subscription PayPal holds, by ID. */
  readonly subscriptions: Map<string, StoredSubscription>;
  /** The payer approves the subscription on PayPal's page: it turns `ACTIVE` and charges the first month at once. */
  readonly approveSubscription: (subscriptionId: string) => SubscriptionPayment;
  /** PayPal charges an active subscription's next month. */
  readonly chargeSubscription: (subscriptionId: string) => SubscriptionPayment;
  /** PayPal fails a charge, as it does for a card that is refused. */
  readonly failSubscriptionCharge: (subscriptionId: string) => void;
  /** A delivery of PAYMENT.SALE.COMPLETED for a subscription's charge, as PayPal would send it: no custom ID, only the subscription it belongs to. */
  readonly saleEvent: (subscriptionId: string, paymentId: string, eventId?: string) => WebhookDelivery;
  /** A delivery of a BILLING.SUBSCRIPTION.* event for a subscription. */
  readonly subscriptionEvent: (subscriptionId: string, eventType: string, eventId?: string) => WebhookDelivery;
  /** Every invoice PayPal holds, by ID. */
  readonly invoices: Map<string, StoredInvoice>;
  /** PayPal refuses the next invoice with this issue, such as `INVALID_EMAIL`, and makes nothing. */
  refuseNextInvoice: string | null;
  /** The member pays a sent invoice on PayPal's page: PayPal captures it, with its fee, and lists the capture on the invoice. */
  readonly payInvoice: (invoiceId: string) => Capture;
  /** A delivery of an INVOICING.INVOICE.* event, as Invoicing v2 sends it: the invoice wrapped in `resource.invoice`. */
  readonly invoiceEvent: (invoiceId: string, eventType: string, eventId?: string) => WebhookDelivery;
};

/**
 * PayPal's pool account in memory, for tests in every package. It keeps the
 * rules the real one does that Kin relies on: a capture needs an approval,
 * a repeated request ID repeats nothing, and only a completed capture has a fee.
 */
export function fakePool(options: { now?: () => Date } = {}): FakePool {
  const now = options.now ?? (() => new Date("2026-10-16T15:00:00Z"));
  const orders = new Map<string, StoredOrder>();
  const captures = new Map<string, Capture>();
  // PayPal's IDs are unique everywhere, so each fake draws its own.
  const instance = randomBytes(4).toString("hex").toUpperCase();
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}${instance}${String((sequence += 1)).padStart(6, "0")}`;
  const view = (order: StoredOrder): Order => ({ id: order.id, status: order.status, reference: order.reference, amount: order.amount, captures: [...order.captures] });
  const find = (orderId: string): StoredOrder => {
    const order = orders.get(orderId);
    if (!order) throw new PayPalError({ outcome: "rejected", status: 404, issue: "RESOURCE_NOT_FOUND", debugId: "fake", operation: "orders" });
    return order;
  };

  const payouts = new Map<string, StoredPayout>();
  const payoutTransactions = new Map<string, TransactionRecord>();
  const invoices = new Map<string, StoredInvoice>();
  const findInvoice = (invoiceId: string): StoredInvoice => {
    const stored = invoices.get(invoiceId);
    if (!stored) throw new PayPalError({ outcome: "rejected", status: 404, issue: "RESOURCE_NOT_FOUND", debugId: "fake", operation: "invoices" });
    return stored;
  };
  const invoiceView = (stored: StoredInvoice): Invoice => ({
    id: stored.id,
    number: stored.number,
    status: stored.status,
    reference: stored.request.reference,
    amount: stored.request.amount,
    payerUrl: `https://www.sandbox.paypal.com/invoice/p/#${stored.id}`,
    payments: [...stored.payments],
  });
  const subscriptions = new Map<string, StoredSubscription>();
  const payoutBatch = (batchId: string, request: NewPayout, status: PayoutItemStatus, itemId: string): PayoutBatch => ({
    batchId,
    batchStatus: status === "SUCCESS" ? "SUCCESS" : status === "PENDING" || status === "UNCLAIMED" || status === "ONHOLD" ? "PROCESSING" : "SUCCESS",
    senderBatchId: request.senderBatchId,
    items: [
      {
        itemId,
        status,
        transactionId: status === "SUCCESS" ? nextId("TX") : null,
        amount: request.amount,
        fee: status === "SUCCESS" ? { cents: pool.payoutFeeCents, currency: request.amount.currency } : null,
        senderItemId: request.senderBatchId,
        wallet: request.wallet ?? "PAYPAL",
      },
    ],
  });

  const pool: FakePool = {
    feeCents: 52,
    payoutStatus: "SUCCESS",
    refuseNextPayout: null,
    payoutFeeCents: 25,
    payouts,
    loseNextReply: null,
    captureStatus: "COMPLETED",
    signaturesValid: true,
    requestIds: [],
    orders,
    failNext: null,
    async createOrder(order, requestId) {
      fail("createOrder");
      pool.requestIds.push(requestId);
      const repeated = [...orders.values()].find((each) => each.requestIds.has(requestId));
      if (repeated) return { orderId: repeated.id };
      const id = nextId("ORDER");
      orders.set(id, { id, status: "CREATED", reference: order.reference, amount: order.amount, captures: [], requestIds: new Set([requestId]) });
      return { orderId: id };
    },
    async getOrder(orderId) {
      fail("getOrder");
      return view(find(orderId));
    },
    async captureOrder(orderId, requestId) {
      fail("captureOrder");
      pool.requestIds.push(requestId);
      const order = find(orderId);
      if (order.status === "COMPLETED" && order.requestIds.has(requestId)) return view(order);
      if (order.status !== "APPROVED") {
        throw new PayPalError({ outcome: "rejected", status: 422, issue: order.status === "COMPLETED" ? "ORDER_ALREADY_CAPTURED" : "ORDER_NOT_APPROVED", debugId: "fake", operation: "orders.capture" });
      }
      const capture: Capture = {
        id: nextId("CAPTURE"),
        status: pool.captureStatus,
        orderId,
        reference: order.reference,
        invoiceId: null,
        gross: order.amount,
        fee: { cents: pool.captureStatus === "COMPLETED" ? pool.feeCents : 0, currency: order.amount.currency },
        createdAt: now(),
      };
      captures.set(capture.id, capture);
      order.captures.push(capture);
      order.status = "COMPLETED";
      order.requestIds.add(requestId);
      return view(order);
    },
    async getCapture(captureId) {
      fail("getCapture");
      const capture = captures.get(captureId);
      if (!capture) throw new PayPalError({ outcome: "rejected", status: 404, issue: "RESOURCE_NOT_FOUND", debugId: "fake", operation: "captures.get" });
      return capture;
    },
    async verifyWebhook() {
      fail("verifyWebhook");
      return pool.signaturesValid;
    },
    async createPayout(request, requestId) {
      fail("createPayout");
      // The real pool builds the request first and sends nothing PayPal would refuse for its shape.
      payoutBody(request);
      pool.requestIds.push(requestId);
      if (pool.refuseNextPayout !== null) {
        const issue = pool.refuseNextPayout;
        pool.refuseNextPayout = null;
        throw new PayPalError({ outcome: "rejected", status: 422, issue, debugId: "fake", operation: "payouts.create" });
      }
      // A batch ID PayPal has paid before makes nothing new; the adapter turns
      // PayPal's refusal into the batch it links (packages/paypal pool.ts).
      const repeated = [...payouts.values()].find((each) => each.request.senderBatchId === request.senderBatchId);
      if (repeated) return lost("createPayout", { batchId: repeated.batch.batchId });
      const batchId = nextId("BATCH");
      payouts.set(batchId, { batch: payoutBatch(batchId, request, pool.payoutStatus, nextId("ITEM")), request });
      return lost("createPayout", { batchId });
    },
    async getPayoutBatch(batchId) {
      fail("getPayoutBatch");
      const stored = payouts.get(batchId);
      if (!stored) throw new PayPalError({ outcome: "rejected", status: 404, issue: "RESOURCE_NOT_FOUND", debugId: "fake", operation: "payouts.get" });
      return stored.batch;
    },
    payoutTransactions,
    async getPayoutTransaction(payoutItemId) {
      fail("getPayoutTransaction");
      return payoutTransactions.get(payoutItemId) ?? null;
    },
    settlePayout(batchId, status) {
      const stored = payouts.get(batchId);
      const item = stored?.batch.items[0];
      if (!stored || !item) throw new Error(`No payout ${batchId}`);
      stored.batch = payoutBatch(batchId, stored.request, status, item.itemId);
    },
    subscriptions,
    async createSubscription(subscription, key) {
      fail("createSubscription");
      pool.requestIds.push(`kin-subscription-${key}`);
      const repeated = [...subscriptions.values()].find((each) => each.key === key);
      if (repeated) return { subscriptionId: repeated.id, approvalUrl: `https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=${repeated.id}` };
      const id = nextId("I-");
      subscriptions.set(id, { id, key, status: "APPROVAL_PENDING", reference: subscription.reference, amount: subscription.amount, payments: [], failedPayments: 0, requestIds: new Set() });
      return { subscriptionId: id, approvalUrl: `https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=${id}` };
    },
    async getSubscription(subscriptionId): Promise<Subscription> {
      fail("getSubscription");
      const stored = findSubscription(subscriptionId);
      return { id: stored.id, status: stored.status, reference: stored.reference, nextBillingAt: stored.status === "ACTIVE" ? now() : null, failedPayments: stored.failedPayments };
    },
    async listSubscriptionPayments(subscriptionId, from, until) {
      fail("listSubscriptionPayments");
      return findSubscription(subscriptionId).payments.filter((payment) => payment.paidAt >= from && payment.paidAt <= until);
    },
    async changeSubscription(subscriptionId, action: SubscriptionAction, _reason, requestId) {
      fail("changeSubscription");
      pool.requestIds.push(requestId);
      const stored = findSubscription(subscriptionId);
      if (stored.requestIds.has(requestId)) return;
      const next: SubscriptionStatus = action === "suspend" ? "SUSPENDED" : action === "activate" ? "ACTIVE" : "CANCELLED";
      const allowed = action === "cancel" ? stored.status !== "CANCELLED" : action === "suspend" ? stored.status === "ACTIVE" : stored.status === "SUSPENDED";
      if (!allowed) throw new PayPalError({ outcome: "rejected", status: 422, issue: "SUBSCRIPTION_STATUS_INVALID", debugId: "fake", operation: `subscriptions.${action}` });
      stored.status = next;
      stored.requestIds.add(requestId);
    },
    async reviseSubscription(subscriptionId, amount, _returnUrl, requestId) {
      fail("reviseSubscription");
      pool.requestIds.push(requestId);
      const stored = findSubscription(subscriptionId);
      if (stored.status !== "ACTIVE" && stored.status !== "SUSPENDED") throw new PayPalError({ outcome: "rejected", status: 422, issue: "SUBSCRIPTION_STATUS_INVALID", debugId: "fake", operation: "subscriptions.revise" });
      if (!stored.requestIds.has(requestId)) (stored.revisions ??= []).push(amount);
      stored.requestIds.add(requestId);
      return { approvalUrl: `https://www.sandbox.paypal.com/webapps/billing/subscriptions/update?ba_token=BA-${stored.id.slice(2)}` };
    },
    approveSubscription(subscriptionId) {
      const stored = findSubscription(subscriptionId);
      if (stored.status !== "APPROVAL_PENDING") throw new Error(`Subscription ${subscriptionId} is not waiting for approval`);
      stored.status = "ACTIVE";
      return pool.chargeSubscription(subscriptionId);
    },
    chargeSubscription(subscriptionId) {
      const stored = findSubscription(subscriptionId);
      if (stored.status !== "ACTIVE") throw new Error(`Subscription ${subscriptionId} is not active`);
      const payment: SubscriptionPayment = { id: nextId("SALE"), gross: stored.amount, fee: { cents: pool.feeCents, currency: stored.amount.currency }, paidAt: now() };
      stored.payments.push(payment);
      return payment;
    },
    failSubscriptionCharge(subscriptionId) {
      findSubscription(subscriptionId).failedPayments += 1;
    },
    saleEvent(subscriptionId, paymentId, eventId = `WH-${paymentId}`) {
      return delivery(eventId, { id: eventId, event_type: "PAYMENT.SALE.COMPLETED", resource_type: "sale", resource: { id: paymentId, state: "completed", billing_agreement_id: subscriptionId } });
    },
    subscriptionEvent(subscriptionId, eventType, eventId = `WH-${eventType}-${subscriptionId}`) {
      const stored = findSubscription(subscriptionId);
      return delivery(eventId, { id: eventId, event_type: eventType, resource_type: "subscription", resource: { id: subscriptionId, status: stored.status, custom_id: encodeContributionReference(stored.reference) } });
    },
    invoices,
    refuseNextInvoice: null,
    async createInvoice(request, requestId) {
      fail("createInvoice");
      pool.requestIds.push(requestId);
      // The adapter finds an invoice PayPal already holds by its number (pool.ts), so a repeat makes nothing.
      const repeated = [...invoices.values()].find((each) => each.request.number === request.number);
      if (repeated) return lost("createInvoice", { invoiceId: repeated.id });
      if (pool.refuseNextInvoice !== null) {
        const issue = pool.refuseNextInvoice;
        pool.refuseNextInvoice = null;
        throw new PayPalError({ outcome: "rejected", status: 422, issue, debugId: "fake", operation: "invoices.create" });
      }
      const serial = String((sequence += 1)).padStart(8, "0");
      const id = `INV2-${instance.slice(0, 4)}-${instance.slice(4, 8)}-${serial.slice(0, 4)}-${serial.slice(4)}`;
      invoices.set(id, { id, number: request.number, status: "DRAFT", request, payments: [], requestIds: new Set([requestId]) });
      return lost("createInvoice", { invoiceId: id });
    },
    async sendInvoice(invoiceId, requestId) {
      fail("sendInvoice");
      pool.requestIds.push(requestId);
      const stored = findInvoice(invoiceId);
      if (stored.requestIds.has(requestId)) return lost("sendInvoice", undefined);
      if (stored.status !== "DRAFT") throw new PayPalError({ outcome: "rejected", status: 422, issue: "INVALID_INVOICE_STATUS", debugId: "fake", operation: "invoices.send" });
      stored.status = "SENT";
      stored.requestIds.add(requestId);
      return lost("sendInvoice", undefined);
    },
    async getInvoice(invoiceId) {
      fail("getInvoice");
      return invoiceView(findInvoice(invoiceId));
    },
    async cancelInvoice(invoiceId, _note, requestId) {
      fail("cancelInvoice");
      pool.requestIds.push(requestId);
      const stored = findInvoice(invoiceId);
      if (stored.requestIds.has(requestId)) return;
      if (stored.status !== "SENT" && stored.status !== "UNPAID") throw new PayPalError({ outcome: "rejected", status: 422, issue: "INVALID_INVOICE_STATUS", debugId: "fake", operation: "invoices.cancel" });
      stored.status = "CANCELLED";
      stored.requestIds.add(requestId);
    },
    payInvoice(invoiceId) {
      const stored = findInvoice(invoiceId);
      if (stored.status !== "SENT") throw new Error(`Invoice ${invoiceId} is not waiting for payment`);
      const capture: Capture = {
        id: nextId("CAPTURE"),
        status: "COMPLETED",
        orderId: nextId("ORDER"),
        reference: null,
        invoiceId,
        gross: stored.request.amount,
        fee: { cents: pool.feeCents, currency: stored.request.amount.currency },
        createdAt: now(),
      };
      captures.set(capture.id, capture);
      stored.payments.push({ paymentId: capture.id, viaPayPal: true, amount: stored.request.amount });
      stored.status = "PAID";
      return capture;
    },
    invoiceEvent(invoiceId, eventType, eventId = `WH-${eventType}-${invoiceId}`) {
      const stored = findInvoice(invoiceId);
      return delivery(eventId, { id: eventId, event_type: eventType, resource_type: "invoices", resource: { invoice: { id: stored.id, status: stored.status } } });
    },
    approve(orderId) {
      const order = find(orderId);
      if (order.status === "CREATED") order.status = "APPROVED";
    },
    completedEvent(captureId, eventId = `WH-${captureId}`) {
      const capture = captures.get(captureId);
      if (!capture) throw new Error(`No capture ${captureId}`);
      const body = JSON.stringify({
        id: eventId,
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource_type: "capture",
        resource: {
          id: capture.id,
          status: capture.status,
          custom_id: capture.reference === null ? undefined : encodeContributionReference(capture.reference),
          invoice_id: capture.invoiceId ?? undefined,
          amount: { currency_code: capture.gross.currency, value: "0.00" },
        },
      });
      return {
        body,
        headers: {
          "paypal-auth-algo": "SHA256withRSA",
          "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-fake",
          "paypal-transmission-id": `T-${eventId}`,
          "paypal-transmission-sig": "c2lnbmF0dXJl",
          "paypal-transmission-time": now().toISOString(),
        },
      };
    },
  };

  function findSubscription(subscriptionId: string): StoredSubscription {
    const stored = subscriptions.get(subscriptionId);
    if (!stored) throw new PayPalError({ outcome: "rejected", status: 404, issue: "RESOURCE_NOT_FOUND", debugId: "fake", operation: "subscriptions" });
    return stored;
  }

  function delivery(eventId: string, event: unknown): WebhookDelivery {
    return {
      body: JSON.stringify(event),
      headers: {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-fake",
        "paypal-transmission-id": `T-${eventId}`,
        "paypal-transmission-sig": "c2lnbmF0dXJl",
        "paypal-transmission-time": now().toISOString(),
      },
    };
  }

  function lost<T>(method: keyof PayPalPool, answer: T): T {
    if (pool.loseNextReply !== method) return answer;
    pool.loseNextReply = null;
    throw new PayPalError({ outcome: "unavailable", status: null, issue: null, debugId: "fake", operation: method });
  }

  function fail(method: keyof PayPalPool): void {
    if (pool.failNext !== method) return;
    pool.failNext = null;
    throw new PayPalError({ outcome: "unavailable", status: 503, issue: null, debugId: "fake", operation: method });
  }

  return pool;
}
