import { deliveryStateAfter, type DeliveryState } from "@kin/domain";

/** Where an order stands once the seller has it. Never `awaiting`: that is before it is placed. */
export type OrderProgress = Exclude<DeliveryState, "awaiting">;

/**
 * How the seller was paid. A real charge carries PayPal's capture ID; a
 * simulated one carries none, so the two can never be mistaken for each other.
 */
export type Charge = { readonly kind: "simulated" } | { readonly kind: "paypal"; readonly captureId: string };

/** What Kin asks of a seller (docs/architecture.md section 8.6): take an order, and say where it is. */
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
};

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
// PayPal's own capture IDs are letters and digits. One that calls itself simulated is not PayPal's.
const CAPTURE_ID = /^(?!simulated)[A-Za-z0-9_-]{1,80}$/i;
const PROGRESS: readonly OrderProgress[] = ["ordered", "shipped", "out_for_delivery", "delivered"];

/**
 * The demo pharmacy as a separate service (`apps/demo-merchant`), reached
 * over HTTP. Its answers are parsed, never trusted: a reference or state it
 * should not send is treated as the seller being unreachable.
 */
export function httpMerchant(baseUrl: string, send: typeof fetch = fetch): Merchant {
  const url = (path: string) => new URL(path, baseUrl).toString();
  const read = async (response: Response): Promise<Record<string, unknown>> => {
    if (response.status >= 500) throw new MerchantError(true);
    if (!response.ok) throw new MerchantError(false);
    const body: unknown = await response.json().catch(() => null);
    if (typeof body !== "object" || body === null) throw new MerchantError(true);
    return body as Record<string, unknown>;
  };
  return {
    placeOrder: async (order) => {
      const request = { key: order.key, item: order.item, cents: order.cents, currency: order.currency, ...(order.mandate ? { mandate: order.mandate } : {}) };
      const body = await read(await send(url("/orders"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }).catch(() => { throw new MerchantError(true); }));
      const ref = body["ref"];
      const charge = parseCharge(body["charge"]);
      // An order whose charge cannot be read is asked about again: the same key returns the same order and the same charge.
      if (typeof ref !== "string" || !ORDER_REF.test(ref) || charge === null) throw new MerchantError(true);
      return { ref, charge };
    },
    progressOf: async ({ ref }) => {
      if (!ORDER_REF.test(ref)) throw new MerchantError(false);
      const body = await read(await send(url(`/orders/${ref}`)).catch(() => { throw new MerchantError(true); }));
      const state = PROGRESS.find((each) => each === body["state"]);
      if (state === undefined) throw new MerchantError(true);
      return state;
    },
  };
}

/** The seller's account of how it was paid, or `null` when it is not one of the two shapes it may send. */
function parseCharge(value: unknown): Charge | null {
  if (typeof value !== "object" || value === null) return null;
  const { kind, captureId, ...extra } = value as Record<string, unknown>;
  if (Object.keys(extra).length > 0) return null;
  if (kind === "simulated") return captureId === undefined ? { kind: "simulated" } : null;
  if (kind === "paypal") return typeof captureId === "string" && CAPTURE_ID.test(captureId) ? { kind: "paypal", captureId } : null;
  return null;
}
