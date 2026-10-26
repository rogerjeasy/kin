import {
  asService,
  beginPayout,
  confirmPayout,
  failPayout,
  readPayoutJob,
  recordHeld,
  recordPending,
  recordSubmitted,
  recordUnknown,
  type Database,
  type PayoutJob,
} from "@kin/db";
import { PayPalError, payoutOutcome, type PayPalPool, type PayoutBatch } from "@kin/paypal";

export type PayoutDeps = {
  /** Connected as `kin_service`. Every transaction names the one circle it acts for. */
  readonly db: Database;
  readonly pool: PayPalPool;
  readonly now: () => Date;
  /** The fee to reserve for one payout in the circle's currency, before PayPal says what it charged. */
  readonly feeReserve: (currency: string) => number;
};

/** Where a payout stands after one turn: finished, or to be looked at again after a while. */
export type PayoutStep =
  | { readonly next: "done"; readonly result: "confirmed" | "failed" | "gone" }
  | { readonly next: "later"; readonly seconds: number; readonly result: "held" | "pending" | "unknown" };

const SOON_SECONDS = 30;
const HELD_SECONDS = 15 * 60;

/**
 * Carries an approved payout one step further, as far as it can go now:
 * ready it, ask PayPal to pay, read PayPal's record, and only then record
 * the money as paid. Each database step locks the execution, and every
 * PayPal write carries the execution's key, so a step repeated after a crash
 * or a lost answer repeats nothing (docs/architecture.md section 7.6).
 */
export async function executePayout(deps: PayoutDeps, circleId: string, executionId: string): Promise<PayoutStep> {
  const prepared = await asService(deps.db, circleId, async (tx): Promise<{ readonly step: PayoutStep } | { readonly job: PayoutJob }> => {
    const job = await readPayoutJob(tx, executionId, deps.now());
    if (job === null || job.state === "confirmed" || job.state === "failed") return { step: done("gone") };
    if (job.state !== "created") return { job };
    const ready = await beginPayout(tx, job, deps.feeReserve(job.currency));
    if (ready !== "ready") {
      await recordHeld(tx, job, ready);
      // A pause is looked at again as it lifts, at most a quarter of an hour on.
      const untilLifted = ready === "paused" && job.pausedUntil ? Math.ceil((job.pausedUntil.getTime() - job.now.getTime()) / 1000) : HELD_SECONDS;
      return { step: later("held", Math.max(1, Math.min(HELD_SECONDS, untilLifted))) };
    }
    if (job.simulated) return { step: await paySimulated(tx, job, deps) };
    return { job };
  });
  if ("step" in prepared) return prepared.step;
  const { job } = prepared;
  const batchId = job.batchId ?? (await askPayPal(deps, job));
  if (batchId === "failed" || batchId === "unknown") return batchId === "failed" ? done("failed") : later("unknown", SOON_SECONDS);
  return readBack(deps, job, batchId);
}

// A demo circle's money is simulated: nothing is sent, and the entry says so.
async function paySimulated(tx: Parameters<Parameters<typeof asService>[2]>[0], job: PayoutJob, deps: PayoutDeps): Promise<PayoutStep> {
  const now = job.now;
  await recordSubmitted(tx, job, null, now);
  await confirmPayout(tx, { ...job, state: "submitted" }, { itemId: `simulated-payout-${job.executionId}`, batchId: null, feeCents: deps.feeReserve(job.currency), at: now });
  return done("confirmed");
}

/**
 * Asks PayPal to pay. An answer is the batch, never proof of payment. A
 * refusal means PayPal made nothing. No answer means Kin cannot know: the
 * execution becomes unknown, and the same key is sent again later.
 */
async function askPayPal(deps: PayoutDeps, job: PayoutJob): Promise<string | "failed" | "unknown"> {
  const receiver = job.receiver;
  if (receiver === null) throw new Error("A payout reached PayPal without a receiver");
  try {
    const { batchId } = await deps.pool.createPayout(
      { senderBatchId: job.idempotencyKey, receiver, amount: { cents: job.cents, currency: job.currency }, note: "Payment for your care visits, approved by the family in Kin" },
      job.idempotencyKey,
    );
    if (job.state === "created") await asService(deps.db, job.circleId, (tx) => recordSubmitted(tx, job, batchId, deps.now()));
    return batchId;
  } catch (error) {
    if (!(error instanceof PayPalError)) throw error;
    await asService(deps.db, job.circleId, async (tx) => {
      const locked = await readPayoutJob(tx, job.executionId, deps.now());
      if (locked === null) return;
      if (locked.state === "created") await recordSubmitted(tx, locked, null, deps.now());
      const submitted = { ...locked, state: locked.state === "created" ? ("submitted" as const) : locked.state };
      if (error.outcome === "rejected") await failPayout(tx, submitted, `paypal_${error.status ?? "refused"}`);
      else if (submitted.state === "submitted") await recordUnknown(tx, submitted);
    });
    return error.outcome === "rejected" ? "failed" : "unknown";
  }
}

/** Reads the batch back from PayPal: the record that decides what happened. */
async function readBack(deps: PayoutDeps, job: PayoutJob, batchId: string): Promise<PayoutStep> {
  let batch: PayoutBatch;
  try {
    batch = await deps.pool.getPayoutBatch(batchId);
  } catch (error) {
    if (error instanceof PayPalError && error.outcome === "unavailable") return later(job.state === "unknown" ? "unknown" : "pending", SOON_SECONDS);
    throw error;
  }
  const item = batch.items[0];
  // A batch that is not this execution's would be someone else's money: stop.
  if (batch.senderBatchId !== job.idempotencyKey || item === undefined || item.amount.cents !== job.cents || item.amount.currency !== job.currency) {
    throw new Error(`Payout batch ${batchId} does not match execution ${job.executionId}`);
  }
  return asService(deps.db, job.circleId, async (tx) => {
    const locked = await readPayoutJob(tx, job.executionId, deps.now());
    if (locked === null || locked.state === "confirmed" || locked.state === "failed") return done("gone");
    const outcome = payoutOutcome(item.status);
    if (outcome === "confirmed") {
      await confirmPayout(tx, locked, { itemId: item.itemId, batchId, feeCents: item.fee?.cents ?? 0, at: deps.now() });
      return done("confirmed");
    }
    if (outcome === "failed") {
      await failPayout(tx, locked, `paypal_${item.status.toLowerCase()}`);
      return done("failed");
    }
    await recordPending(tx, locked, batchId);
    return later(locked.state === "unknown" ? "unknown" : "pending", SOON_SECONDS);
  });
}

const done = (result: "confirmed" | "failed" | "gone"): PayoutStep => ({ next: "done", result });
const later = (result: "held" | "pending" | "unknown", seconds: number): PayoutStep => ({ next: "later", seconds, result });
