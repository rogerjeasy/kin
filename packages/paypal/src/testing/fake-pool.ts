import type { Money } from "@kin/domain";
import { randomBytes } from "node:crypto";

import type { Capture, CaptureStatus } from "../capture.ts";
import { encodeContributionReference, type ContributionReference } from "../contribution-reference.ts";
import type { Order } from "../order.ts";
import { PayPalError } from "../paypal-error.ts";
import type { PayPalPool } from "../pool.ts";
import type { NewPayout, PayoutBatch, PayoutItemStatus } from "../payout.ts";
import type { WebhookDelivery } from "../webhook.ts";

type StoredOrder = { id: string; status: string; reference: ContributionReference; amount: Money; captures: Capture[]; requestIds: Set<string> };
type StoredPayout = { batch: PayoutBatch; request: NewPayout };

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
  /** The status PayPal gives the next payouts' items. */
  payoutStatus: PayoutItemStatus;
  /** PayPal's fee on each successful payout item, in cents. */
  payoutFeeCents: number;
  /** Every payout PayPal made, by batch ID. A repeated request makes none. */
  readonly payouts: Map<string, StoredPayout>;
  /** PayPal moves a payout's item on, as it does after a pending or unclaimed payout. */
  readonly settlePayout: (batchId: string, status: PayoutItemStatus) => void;
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
    settlePayout(batchId, status) {
      const stored = payouts.get(batchId);
      const item = stored?.batch.items[0];
      if (!stored || !item) throw new Error(`No payout ${batchId}`);
      stored.batch = payoutBatch(batchId, stored.request, status, item.itemId);
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
