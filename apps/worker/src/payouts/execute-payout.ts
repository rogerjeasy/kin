import {
  asService,
  beginPayout,
  confirmPayout,
  failPayout,
  payoutReceiver,
  readPayoutJob,
  recordHeld,
  recordPending,
  recordSubmitted,
  recordSandboxFallback,
  recordUnknown,
  type Database,
  type PayoutJob,
  type Transaction,
} from "@kin/db";
import { PayPalError, PayoutNotSendableError, payoutOutcome, type PayPalPool, type PayoutBatch, type PayoutWallet } from "@kin/paypal";

import { routeReadiedDemoPayout, routedJob, type SandboxJob, type SandboxPayouts } from "./sandbox-route.ts";

export type PayoutDeps = {
  /** Connected as `kin_service`. Every transaction names the one circle it acts for. */
  readonly db: Database;
  readonly pool: PayPalPool;
  readonly now: () => Date;
  /** The fee to reserve for one payout in the circle's currency, before PayPal says what it charged. */
  readonly feeReserve: (currency: string) => number;
  /** Real PayPal sandbox payouts for demo circles, to Kin's own test account; `null` keeps them simulated. */
  readonly sandbox?: SandboxPayouts;
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
  const prepared = await asService(deps.db, circleId, async (tx): Promise<{ readonly step: PayoutStep } | { readonly job: SandboxJob }> => {
    const read = await readPayoutJob(tx, executionId, deps.now());
    if (read === null || read.state === "confirmed" || read.state === "failed") return { step: done("gone") };
    const job = await routedJob(tx, read);
    if (job.state !== "created") return { job };
    const ready = await beginPayout(tx, job, deps.feeReserve(job.currency));
    if (ready !== "ready") {
      await recordHeld(tx, job, ready);
      // A pause is looked at again as it lifts, at most a quarter of an hour on.
      const untilLifted = ready === "paused" && job.pausedUntil ? Math.ceil((job.pausedUntil.getTime() - job.now.getTime()) / 1000) : HELD_SECONDS;
      return { step: later("held", Math.max(1, Math.min(HELD_SECONDS, untilLifted))) };
    }
    if (job.simulated) {
      // A demo payout, approved and readied like any other, may go to PayPal's sandbox instead.
      const routed = await routeReadiedDemoPayout(tx, job, deps.sandbox ?? null, deps.now());
      return routed.sandbox ? { job: routed } : { step: await paySimulated(tx, job) };
    }
    // beginPayout fixed the address on the execution if it had none. A sandbox payout's address is Kin's, already set.
    return { job: job.sandbox ? job : { ...job, receiver: payoutReceiver(job) } };
  });
  if ("step" in prepared) return prepared.step;
  const { job } = prepared;
  const batchId = job.batchId ?? (await askPayPal(deps, job));
  if (batchId === "simulated") return done("confirmed");
  if (batchId === "failed" || batchId === "unknown") return batchId === "failed" ? done("failed") : later("unknown", SOON_SECONDS);
  return readBack(deps, job, batchId);
}

// A demo circle's money is simulated: nothing is sent, and the entry says so.
// No fee either: PayPal charged nothing, as for a simulated share or Purse payment.
async function paySimulated(tx: Transaction, job: PayoutJob): Promise<PayoutStep> {
  const now = job.now;
  if (job.state === "created") await recordSubmitted(tx, job, null, now);
  const submitted = { ...job, simulated: true, state: job.state === "created" ? ("submitted" as const) : job.state };
  await confirmPayout(tx, submitted, { itemId: `simulated-payout-${job.executionId}`, batchId: null, feeCents: 0, at: now });
  return done("confirmed");
}

/**
 * PayPal's sandbox would not pay a demo payout: rather than leave the demo
 * stuck, it is paid simulated, labelled so, with PayPal's reason recorded.
 * Only on PayPal's own refusal or failed item: never while its answer is unknown.
 */
async function fallBackToSimulated(tx: Transaction, job: PayoutJob, deps: PayoutDeps, reason: string): Promise<PayoutStep> {
  await recordSandboxFallback(tx, job, reason);
  return paySimulated(tx, job);
}

/**
 * Asks PayPal to pay. An answer is the batch, never proof of payment. A
 * refusal means PayPal made nothing. No answer means Kin cannot know: the
 * execution becomes unknown, and the same key is sent again later.
 */
async function askPayPal(deps: PayoutDeps, job: SandboxJob): Promise<string | "failed" | "unknown" | "simulated"> {
  const receiver = job.receiver;
  if (receiver === null) throw new Error("A payout reached PayPal without a receiver");
  try {
    const { batchId } = await deps.pool.createPayout(
      {
        senderBatchId: job.idempotencyKey,
        receiver,
        amount: { cents: job.cents, currency: job.currency },
        note: job.kind === "member_payout" ? "Your share of the family's care costs, settled and approved in Kin" : "Payment for your care visits, approved by the family in Kin",
        // A PayPal wallet is the adapter's default, so only a Venmo payout says where it goes.
        ...(walletOf(job) === "VENMO" ? { wallet: "VENMO" as const } : {}),
      },
      job.idempotencyKey,
    );
    if (job.state === "created") await asService(deps.db, job.circleId, (tx) => recordSubmitted(tx, job, batchId, deps.now()));
    return batchId;
  } catch (error) {
    // A payout Kin will not send (a Venmo payout outside USD, an address it cannot read) went nowhere: it fails
    // for good, as PayPal's own refusal would, and is never retried. The reason names no receiver.
    const refusal = error instanceof PayoutNotSendableError ? { outcome: "rejected" as const, issue: null, reason: `not_sent_${error.reason}` } : error instanceof PayPalError ? { outcome: error.outcome, issue: error.issue, reason: `paypal_${error.status ?? "refused"}` } : null;
    if (refusal === null) throw error;
    await asService(deps.db, job.circleId, async (tx) => {
      const locked = await readPayoutJob(tx, job.executionId, deps.now());
      if (locked === null) return;
      if (locked.state === "created") await recordSubmitted(tx, locked, null, deps.now());
      const submitted = { ...locked, state: locked.state === "created" ? ("submitted" as const) : locked.state };
      if (refusal.outcome === "rejected" && job.sandbox) await fallBackToSimulated(tx, submitted, deps, refusal.issue === null ? refusal.reason : `${refusal.reason}_${refusal.issue.toLowerCase()}`);
      else if (refusal.outcome === "rejected") await failPayout(tx, submitted, refusal.reason);
      else if (submitted.state === "submitted") await recordUnknown(tx, submitted);
    });
    if (refusal.outcome === "rejected") return job.sandbox ? "simulated" : "failed";
    return "unknown";
  }
}

/** Which wallet the family approved the payout for, fixed when it was queued. */
const walletOf = (job: PayoutJob): PayoutWallet => (job.wallet === "venmo" ? "VENMO" : "PAYPAL");

/** Reads the batch back from PayPal: the record that decides what happened. */
async function readBack(deps: PayoutDeps, job: SandboxJob, batchId: string): Promise<PayoutStep> {
  let batch: PayoutBatch;
  try {
    batch = await deps.pool.getPayoutBatch(batchId);
  } catch (error) {
    if (error instanceof PayPalError && error.outcome === "unavailable") return later(job.state === "unknown" ? "unknown" : "pending", SOON_SECONDS);
    throw error;
  }
  const item = batch.items[0];
  // A batch that is not this execution's would be someone else's money: stop.
  // PayPal names the wallet an item went to in its read-back; when it does, it must be the one approved.
  if (batch.senderBatchId !== job.idempotencyKey || item === undefined || item.amount.cents !== job.cents || item.amount.currency !== job.currency || (item.wallet !== null && item.wallet !== walletOf(job))) {
    throw new Error(`Payout batch ${batchId} does not match execution ${job.executionId}`);
  }
  return asService(deps.db, job.circleId, async (tx) => {
    const read = await readPayoutJob(tx, job.executionId, deps.now());
    if (read === null || read.state === "confirmed" || read.state === "failed") return done("gone");
    const locked = await routedJob(tx, read);
    const outcome = payoutOutcome(item.status);
    if (outcome === "confirmed") {
      await confirmPayout(tx, locked, { itemId: item.itemId, batchId, feeCents: item.fee?.cents ?? 0, at: deps.now() });
      return done("confirmed");
    }
    if (outcome === "failed" && locked.sandbox) return fallBackToSimulated(tx, locked, deps, `paypal_${item.status.toLowerCase()}`);
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
