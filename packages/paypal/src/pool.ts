import { parseCapture, type Capture } from "./capture.ts";
import type { PayPalClient } from "./client.ts";
import { contributionOrderBody, parseOrder, type NewContributionOrder, type Order } from "./order.ts";
import { requiredText, asRecord } from "./json.ts";
import { PayPalError } from "./paypal-error.ts";
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
  /** Asks PayPal whether a delivery really came from it, for this pool's webhook. */
  readonly verifyWebhook: (delivery: WebhookDelivery) => Promise<boolean>;
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

/** Whether `id` has the shape of a PayPal order or capture ID. */
export function isPayPalId(id: string): boolean {
  return ORDER_ID.test(id);
}

// An ID goes into a URL path, so anything but PayPal's own alphabet is refused.
function pathId(id: string): string {
  if (!isPayPalId(id)) throw new Error("Not a PayPal resource ID");
  return id;
}
