import { MERCHANT_SIGNATURE_HEADER, signMerchantRequest } from "@kin/auth";
import { decimalAmount, deliveryStateAfter, type DeliveryState } from "@kin/domain";

/** Where an order stands once the seller has it. Never `awaiting`: that is before it is placed. */
export type OrderProgress = Exclude<DeliveryState, "awaiting">;

/**
 * How the seller says it was paid. A real charge carries PayPal's order and
 * capture IDs; a simulated one carries none, so the two can never be mistaken
 * for each other. A real one is recorded only once PayPal's record, read back,
 * agrees (`confirmsCharge`).
 */
export type Charge = { readonly kind: "simulated" } | { readonly kind: "paypal"; readonly orderId: string; readonly captureId: string };

/** PayPal's record of one of the seller's orders, as the seller read it from PayPal when asked. */
export type PaymentReadBack = {
  readonly orderId: string;
  readonly status: string;
  readonly customId: string | null;
  readonly capture: { readonly id: string; readonly status: string; readonly value: string; readonly currency: string } | null;
};

/** What Kin asks of a seller (docs/architecture.md section 8.6): take an order, say where it is, and read its payment back from PayPal. */
export type Merchant = {
  /** The same `key` always names the same order, so a repeated request buys nothing twice. */
  readonly placeOrder: (order: {
    readonly key: string;
    readonly item: string;
    readonly cents: number;
    readonly currency: string;
    /** The parent's standing permission the order is bought under, with the most it allows for one purchase: the seller's own check. */
    readonly mandate?: { readonly id: string; readonly allowanceCents: number };
  }) => Promise<{ readonly ref: string; readonly charge: Charge }>;
  readonly progressOf: (order: { readonly ref: string; readonly placedAt: Date; readonly now: Date }) => Promise<OrderProgress>;
  /** PayPal's record of the order now, or `null` when the seller says PayPal has no such order. */
  readonly readPayment: (orderId: string) => Promise<PaymentReadBack | null>;
};

/** PayPal's record does not show the charge the seller reported. Nothing is recorded; it is looked at again later. */
export class ChargeNotConfirmedError extends Error {
  readonly retryable = true;

  constructor() {
    super("PayPal's record does not show the charge the seller reported");
    this.name = "ChargeNotConfirmedError";
  }
}

/**
 * Whether PayPal's record, read back, shows exactly the charge Kin asked for:
 * the order the seller named, made under this purchase's own key, captured
 * `COMPLETED` under the capture the seller named, for exactly the amount and
 * currency approved (AGENTS.md section 5, rule 3).
 */
export function confirmsCharge(
  record: PaymentReadBack | null,
  asked: { readonly orderId: string; readonly captureId: string; readonly key: string; readonly cents: number; readonly currency: string },
): boolean {
  if (record === null || record.capture === null) return false;
  const { capture } = record;
  return (
    record.orderId === asked.orderId &&
    record.status === "COMPLETED" &&
    record.customId === asked.key &&
    capture.id === asked.captureId &&
    capture.status === "COMPLETED" &&
    capture.currency === asked.currency &&
    capture.value === decimalAmount({ cents: asked.cents, currency: asked.currency })
  );
}

/**
 * A demo circle's seller, in process: it takes every order and delivers on
 * the demo pharmacy's own schedule. Nothing is sent anywhere, and everything
 * Kin writes about it says simulated.
 */
export const simulatedMerchant: Merchant = {
  placeOrder: async ({ key, cents, mandate }) => {
    // A second, independent enforcement point: the seller refuses a charge beyond the allowance.
    if (mandate !== undefined && cents > mandate.allowanceCents) throw new MerchantError(false);
    return { ref: `simulated-order-${key}`, charge: { kind: "simulated" } };
  },
  progressOf: async ({ placedAt, now }) => deliveryStateAfter(Math.max(0, (now.getTime() - placedAt.getTime()) / 1000)),
  // It charges nothing, so PayPal has no order of it.
  readPayment: async () => null,
};

/** A seller that is a failure to reach, or that refused. Reaching it again may help only if it is `retryable`. */
export class MerchantError extends Error {
  readonly retryable: boolean;

  constructor(retryable: boolean) {
    super(retryable ? "The seller could not be reached" : "The seller refused the order");
    this.name = "MerchantError";
    this.retryable = retryable;
  }
}

const ORDER_REF = /^[A-Za-z0-9_-]{1,80}$/;
/** PayPal's order IDs: capitals and digits. Anything else is never asked about. */
const PAYPAL_ORDER_ID = /^[A-Z0-9]{8,36}$/;
// PayPal's own capture IDs are letters and digits. One that calls itself simulated is not PayPal's.
const CAPTURE_ID = /^(?!simulated)[A-Za-z0-9_-]{1,80}$/i;
const PROGRESS: readonly OrderProgress[] = ["ordered", "shipped", "out_for_delivery", "delivered"];

/** Where the demo pharmacy is, and the secret the worker signs every request to it with. */
export type MerchantEndpoint = { readonly url: string; readonly signingSecret: string };

/**
 * The demo pharmacy as a separate service (`apps/demo-merchant`), reached
 * over HTTP. Every request is signed with the secret the two share, over its
 * time, method, path and body. Its answers are parsed, never trusted: a
 * reference, state or payment it should not send is treated as the seller
 * being unreachable, so the purchase is looked at again rather than recorded.
 */
export function httpMerchant(endpoint: MerchantEndpoint, options: { readonly send?: typeof fetch; readonly now?: () => Date } = {}): Merchant {
  const send = options.send ?? fetch;
  const now = options.now ?? (() => new Date());
  const request = async (method: "GET" | "POST", path: string, body?: unknown): Promise<Record<string, unknown> | null> => {
    const rawBody = body === undefined ? "" : JSON.stringify(body);
    const signature = signMerchantRequest(endpoint.signingSecret, Math.floor(now().getTime() / 1000), { method, path, rawBody });
    const headers: Record<string, string> = { [MERCHANT_SIGNATURE_HEADER]: signature, ...(body === undefined ? {} : { "content-type": "application/json" }) };
    const response = await send(new URL(path, endpoint.url).toString(), { method, headers, ...(body === undefined ? {} : { body: rawBody }) }).catch(() => {
      throw new MerchantError(true);
    });
    // A seller that is down, busy (429) or not accepting Kin's signature (401: the deployment is wrong) may be asked again.
    if (response.status >= 500 || response.status === 429 || response.status === 401) throw new MerchantError(true);
    if (response.status === 404) return null;
    if (!response.ok) throw new MerchantError(false);
    const parsed: unknown = await response.json().catch(() => null);
    if (typeof parsed !== "object" || parsed === null) throw new MerchantError(true);
    return parsed as Record<string, unknown>;
  };
  return {
    placeOrder: async (order) => {
      const body = await request("POST", "/orders", { key: order.key, item: order.item, cents: order.cents, currency: order.currency, ...(order.mandate ? { mandate: order.mandate } : {}) });
      if (body === null) throw new MerchantError(false);
      const ref = body["ref"];
      const charge = parseCharge(body["charge"]);
      // An order whose charge cannot be read is asked about again: the same key returns the same order and the same charge.
      if (typeof ref !== "string" || !ORDER_REF.test(ref) || charge === null) throw new MerchantError(true);
      return { ref, charge };
    },
    progressOf: async ({ ref }) => {
      if (!ORDER_REF.test(ref)) throw new MerchantError(false);
      const body = await request("GET", `/orders/${ref}`);
      const state = PROGRESS.find((each) => each === body?.["state"]);
      if (state === undefined) throw new MerchantError(true);
      return state;
    },
    readPayment: async (orderId) => {
      if (!PAYPAL_ORDER_ID.test(orderId)) return null;
      const body = await request("GET", `/payments/${orderId}`);
      if (body === null) return null;
      const payment = parsePayment(body["payment"]);
      if (body["source"] !== "paypal_sandbox" || payment === null) throw new MerchantError(true);
      return payment;
    },
  };
}

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128;

/** PayPal's record as the seller relays it, or `null` when it is not that shape. */
function parsePayment(value: unknown): PaymentReadBack | null {
  if (typeof value !== "object" || value === null) return null;
  const { orderId, status, customId, capture } = value as Record<string, unknown>;
  if (!text(orderId) || !text(status) || !(customId === null || text(customId))) return null;
  if (capture === null) return { orderId, status, customId, capture: null };
  if (typeof capture !== "object" || capture === undefined) return null;
  const { id, status: captureStatus, value: amount, currency } = capture as Record<string, unknown>;
  if (!text(id) || !text(captureStatus) || !text(amount) || !text(currency)) return null;
  return { orderId, status, customId, capture: { id, status: captureStatus, value: amount, currency } };
}

/** The seller's account of how it was paid, or `null` when it is not one of the two shapes it may send. */
function parseCharge(value: unknown): Charge | null {
  if (typeof value !== "object" || value === null) return null;
  const { kind, captureId, orderId, ...extra } = value as Record<string, unknown>;
  if (Object.keys(extra).length > 0) return null;
  if (kind === "simulated") return captureId === undefined && orderId === undefined ? { kind: "simulated" } : null;
  if (kind !== "paypal" || typeof captureId !== "string" || !CAPTURE_ID.test(captureId) || typeof orderId !== "string" || !PAYPAL_ORDER_ID.test(orderId)) return null;
  return { kind: "paypal", orderId, captureId };
}
