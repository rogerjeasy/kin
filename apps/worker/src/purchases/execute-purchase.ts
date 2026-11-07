import {
  asService,
  beginPurchase,
  confirmPurchase,
  failPurchase,
  readDeliveryJob,
  readPurchaseJob,
  recordDelivery,
  recordOrderPlaced,
  recordPurchaseHeld,
  type Database,
} from "@kin/db";
import { DELIVERY_SCHEDULE_SECONDS, nextDeliveryState, type DeliveryState } from "@kin/domain";

import { MerchantError, type Merchant } from "./merchant.ts";

export type PurchaseDeps = {
  /** Connected as `kin_service`. Every transaction names the one circle it acts for. */
  readonly db: Database;
  readonly merchant: Merchant;
  /** The real time, which the order's own schedule runs on, not the demo circle's frozen clock. */
  readonly now: () => Date;
};

/** Where a purchase stands after one turn: finished, or to be looked at again after a while. */
export type PurchaseStep =
  | { readonly next: "done"; readonly result: "confirmed" | "failed" | "gone" }
  | { readonly next: "later"; readonly seconds: number; readonly result: "held" | "unreachable" };

const HELD_SECONDS = 15 * 60;
const SOON_SECONDS = 30;

/**
 * Buys an approved refill, as far as it can go now. The family's yes is
 * already recorded and its execution queued in the same transaction, so the
 * buy cannot be lost or repeated: the order's key is the execution's own, and
 * the ledger takes one capture per execution. A pause or a pool that has not
 * received enough money holds it without changing anything.
 *
 * Only a demo circle's refill is carried out, with simulated money, and the
 * ledger entry says so. A real circle's would charge a saved PayPal wallet,
 * which Kin cannot yet set up; such a purchase is stopped and marked failed,
 * with nothing taken from the pool.
 */
export async function executePurchase(deps: PurchaseDeps, circleId: string, executionId: string): Promise<PurchaseStep> {
  return asService(deps.db, circleId, async (tx): Promise<PurchaseStep> => {
    const job = await readPurchaseJob(tx, executionId, deps.now());
    if (job === null || job.state !== "created") return done("gone");
    const ready = await beginPurchase(tx, job);
    if (ready !== "ready") {
      await recordPurchaseHeld(tx, job, ready);
      const untilLifted = ready === "paused" && job.pausedUntil ? Math.ceil((job.pausedUntil.getTime() - job.now.getTime()) / 1000) : HELD_SECONDS;
      return { next: "later", result: "held", seconds: Math.max(1, Math.min(HELD_SECONDS, untilLifted)) };
    }
    if (!job.simulated) {
      await failPurchase(tx, job, "real_purchases_not_supported");
      return done("failed");
    }
    try {
      const { ref } = await deps.merchant.placeOrder({ key: job.idempotencyKey, item: job.item, cents: job.cents, currency: job.currency });
      await recordOrderPlaced(tx, job, { ref, at: deps.now(), firstLookInSeconds: DELIVERY_SCHEDULE_SECONDS.shipped });
    } catch (error) {
      if (!(error instanceof MerchantError)) throw error;
      // The seller never took it: nothing left the pool, so the refill stops and the family sees it failed.
      if (!error.retryable) {
        await failPurchase(tx, job, "seller_refused");
        return done("failed");
      }
      throw error;
    }
    await confirmPurchase(tx, { ...job, state: "submitted" }, { itemId: `simulated-purchase-${job.executionId}`, at: job.now });
    return done("confirmed");
  });
}

/** Where a delivery stands after one turn. */
export type DeliveryStep = { readonly next: "done" } | { readonly next: "later"; readonly seconds: number };

/**
 * Follows an order to the door. The seller says where it is; each step the
 * order has taken since the last look is recorded in turn, and the database
 * refuses a step its diagram does not draw.
 */
export async function followDelivery(deps: PurchaseDeps, circleId: string, purchaseId: string): Promise<DeliveryStep> {
  return asService(deps.db, circleId, async (tx): Promise<DeliveryStep> => {
    const job = await readDeliveryJob(tx, purchaseId);
    if (job === null || job.state === "delivered") return { next: "done" };
    if (job.state === "awaiting" || job.merchantOrder === null || job.orderedAt === null) return { next: "later", seconds: SOON_SECONDS };
    const now = deps.now();
    const reached = await deps.merchant.progressOf({ ref: job.merchantOrder, placedAt: job.orderedAt, now });
    let state: DeliveryState = job.state;
    while (state !== reached) {
      const step = nextDeliveryState(state);
      if (step === null) break;
      await recordDelivery(tx, circleId, { ...job, state }, step, now);
      state = step;
    }
    return state === "delivered" ? { next: "done" } : { next: "later", seconds: SOON_SECONDS };
  });
}

const done = (result: "confirmed" | "failed" | "gone"): PurchaseStep => ({ next: "done", result });
