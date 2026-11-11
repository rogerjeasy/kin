import { deliveryStateAfter, type DeliveryState } from "@kin/domain";

import { itemOf } from "./catalog.ts";
import { ChargeError, type Charge, type PaymentRecord, type WalletCharger } from "./wallet.ts";

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

/** The pharmacy has charged as many new orders today as it allows. Asking again tomorrow may help. */
export class DailyLimitError extends Error {
  readonly retryable = true;

  constructor() {
    super("The pharmacy has taken all the charges it allows today");
    this.name = "DailyLimitError";
  }
}

const KEY = /^[A-Za-z0-9_-]{1,100}$/;

type OrderBookDeps = {
  readonly wallet: WalletCharger;
  readonly now: () => Date;
  /** The most new charges in one UTC day, however the requests are signed: a bound on what a leaked secret could spend. */
  readonly chargesPerDay?: number;
};

/**
 * The pharmacy's order book. An order's key is its identity: placing the same
 * key again returns the order already taken, and the wallet is charged once.
 * Delivery follows the demo pharmacy's own schedule from the moment it was
 * placed, and says where the order is, never how it will get there.
 */
export function createOrderBook(deps: OrderBookDeps) {
  const byKey = new Map<string, Order>();
  const byRef = new Map<string, Order>();
  // A charge in flight, so two requests with one key cannot both reach the wallet.
  const charging = new Map<string, Promise<Order>>();
  const today = { day: "", count: 0 };

  function countCharge(): void {
    const day = deps.now().toISOString().slice(0, 10);
    if (today.day !== day) Object.assign(today, { day, count: 0 });
    if (deps.chargesPerDay !== undefined && today.count >= deps.chargesPerDay) throw new DailyLimitError();
    today.count += 1;
  }

  async function take(request: OrderRequest): Promise<Order> {
    const item = itemOf(request);
    if (item === null) throw new UnknownItemError();
    // The seller's own check, made before any money is asked for and whatever the buyer has already checked.
    if (request.mandate !== undefined && item.priceCents > request.mandate.allowanceCents) throw new AboveMandateError();
    countCharge();
    const charge = await deps.wallet.charge({ key: request.key, cents: item.priceCents, currency: item.currency, description: item.name }).catch((error: unknown) => {
      // A charge PayPal did not make does not count against the day.
      today.count = Math.max(0, today.count - 1);
      throw error;
    });
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
    /** What PayPal's record of one of the pharmacy's orders says now, read from PayPal: the buyer's proof, not the book's memory. */
    payment(orderId: string): Promise<PaymentRecord | null> {
      return deps.wallet.readOrder(orderId);
    },
  };
}

export type OrderBook = ReturnType<typeof createOrderBook>;
export { ChargeError };
