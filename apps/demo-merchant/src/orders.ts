import { deliveryStateAfter, type DeliveryState } from "@kin/domain";

import { itemOf } from "./catalog.ts";
import { ChargeError, type Charge, type WalletCharger } from "./wallet.ts";

export type OrderRequest = {
  readonly key: string;
  readonly item: string;
  readonly cents: number;
  readonly currency: string;
  /** The standing permission the buyer says it acts under, with the most it allows for one purchase. The pharmacy checks it itself. */
  readonly mandate?: { readonly id: string; readonly allowanceCents: number };
};

type Order = { readonly ref: string; readonly placedAt: Date; readonly charge: Charge };

/** The pharmacy does not sell what was asked at that price. Asking again cannot help. */
export class UnknownItemError extends Error {
  readonly retryable = false;

  constructor() {
    super("The pharmacy does not sell this item at this price");
    this.name = "UnknownItemError";
  }
}

/** The price is more than the standing permission the buyer named allows. Asking again cannot help. */
export class AboveMandateError extends Error {
  readonly retryable = false;

  constructor() {
    super("The price is above what the buyer's standing permission allows");
    this.name = "AboveMandateError";
  }
}

const KEY = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * The pharmacy's order book. An order's key is its identity: placing the same
 * key again returns the order already taken, and the wallet is charged once.
 * Delivery follows the demo pharmacy's own schedule from the moment it was
 * placed, and says where the order is, never how it will get there.
 */
export function createOrderBook(deps: { readonly wallet: WalletCharger; readonly now: () => Date }) {
  const byKey = new Map<string, Order>();
  const byRef = new Map<string, Order>();
  // A charge in flight, so two requests with one key cannot both reach the wallet.
  const charging = new Map<string, Promise<Order>>();

  async function take(request: OrderRequest): Promise<Order> {
    const item = itemOf(request);
    if (item === null) throw new UnknownItemError();
    // The seller's own check, made before any money is asked for and whatever the buyer has already checked.
    if (request.mandate !== undefined && item.priceCents > request.mandate.allowanceCents) throw new AboveMandateError();
    const charge = await deps.wallet.charge({ key: request.key, cents: item.priceCents, currency: item.currency, description: item.name });
    const order: Order = { ref: `order-${request.key}`, placedAt: deps.now(), charge };
    byKey.set(request.key, order);
    byRef.set(order.ref, order);
    return order;
  }

  return {
    async place(request: OrderRequest): Promise<{ readonly ref: string; readonly charge: Charge }> {
      if (!KEY.test(request.key)) throw new UnknownItemError();
      const taken = byKey.get(request.key);
      if (taken) return { ref: taken.ref, charge: taken.charge };
      let pending = charging.get(request.key);
      if (pending === undefined) {
        pending = take(request).finally(() => charging.delete(request.key));
        charging.set(request.key, pending);
      }
      const order = await pending;
      return { ref: order.ref, charge: order.charge };
    },
    progress(ref: string): Exclude<DeliveryState, "awaiting"> | null {
      const order = byRef.get(ref);
      return order ? deliveryStateAfter((deps.now().getTime() - order.placedAt.getTime()) / 1000) : null;
    },
  };
}

export type OrderBook = ReturnType<typeof createOrderBook>;
export { ChargeError };
