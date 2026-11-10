import {
  asService,
  beginPursePayment,
  confirmPursePayment,
  expireUnanswered,
  failPursePayment,
  fundPurse,
  lockPurseJob,
  purseCircles,
  readPurseContext,
  readPurseJobs,
  readUnreconciledPurse,
  recordPurseMismatch,
  recordPurseReconciled,
  recordPurseSubmitted,
  recordPurseUnknown,
  releaseHolds,
  type Database,
  type PurseContext,
  type PurseJob,
} from "@kin/db";
import { PayPalError, PayoutNotSendableError, leftThePool, payoutOutcome, type PayPalPool } from "@kin/paypal";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

export type PurseDeps = {
  /** Connected as `kin_service`. Every transaction names the one circle it acts for. */
  readonly db: Database;
  readonly pool: PayPalPool;
  readonly now: () => Date;
  /** The fee to reserve for one payout in the circle's currency, before PayPal says what it charged. */
  readonly feeReserve: (currency: string) => number;
};

/** What one turn did for one circle, for the log and the tests. */
export type PurseTurn = { readonly funded: number; readonly expired: number; readonly released: number; readonly lapsed: number; readonly paid: number; readonly failed: number; readonly waiting: number };

/** PayPal's Transaction Search lags real time by up to three hours: only payments older than this are looked for. */
const RECONCILE_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * One pass over every circle with Purse work: the week's float, the read-backs
 * nobody answered, the holds whose cooling-off ended, and the approved payments
 * carried as far as they can go. Returns how many circles were looked at.
 */
export async function runPurseBatch(deps: PurseDeps, log: InboxLog): Promise<number> {
  const circles = await purseCircles(deps.db);
  for (const circleId of circles) {
    try {
      const turn = await runPurseTurn(deps, circleId);
      if (Object.values(turn).some((count) => count > 0)) log({ level: "info", message: "purse.turn", circleId, ...turn });
    } catch (error) {
      log({ level: "error", message: "purse.turn_failed", circleId, error: describe(error) });
    }
  }
  return circles.length;
}

/** Everything the Purse needs in one circle, one step at a time, each in its own transaction. */
export async function runPurseTurn(deps: PurseDeps, circleId: string): Promise<PurseTurn> {
  const prepared = await asService(deps.db, circleId, async (tx) => {
    const context = await readPurseContext(tx, circleId, deps.now());
    if (context === null) return null;
    const expired = await expireUnanswered(tx, context);
    const funded = await fundPurse(tx, context);
    const { approved, lapsed } = await releaseHolds(tx, context);
    return { context, expired, funded, released: approved, lapsed, jobs: await readPurseJobs(tx, circleId) };
  });
  if (prepared === null) return { funded: 0, expired: 0, released: 0, lapsed: 0, paid: 0, failed: 0, waiting: 0 };
  let paid = 0;
  let failed = 0;
  let waiting = 0;
  for (const job of prepared.jobs) {
    const outcome = await carry(deps, prepared.context, job);
    if (outcome === "paid") paid += 1;
    else if (outcome === "failed") failed += 1;
    else waiting += 1;
  }
  return { funded: prepared.funded, expired: prepared.expired, released: prepared.released, lapsed: prepared.lapsed, paid, failed, waiting };
}

type Carried = "paid" | "failed" | "waiting";

/**
 * Carries one approved payment as far as it can go now: ready it, pay it
 * (simulated in a demo circle), ask PayPal, and read PayPal's record before
 * calling it paid. Every PayPal write carries the payment's key, so a step
 * repeated after a crash or a lost answer repays nothing (AGENTS.md section 5).
 */
async function carry(deps: PurseDeps, context: PurseContext, listed: PurseJob): Promise<Carried> {
  const ready = await asService(deps.db, context.circleId, async (tx): Promise<{ readonly carried: Carried } | { readonly job: PurseJob }> => {
    const job = await lockPurseJob(tx, context.circleId, listed.paymentId);
    if (job === null) return { carried: "waiting" };
    if (job.state === "approved") {
      const begun = await beginPursePayment(tx, context, job, context.simulated ? 0 : deps.feeReserve(context.currency));
      if (begun === "payee_removed") return { carried: "failed" };
      if (begun !== "ready") return { carried: "waiting" };
      if (context.simulated) {
        // A demo circle's Purse is simulated: nothing is sent, and the entry says so.
        await confirmPursePayment(tx, context, { ...job, state: "executing" }, { itemId: `simulated-purse-${job.paymentId}`, batchId: null, feeCents: 0, at: context.now });
        return { carried: "paid" };
      }
      return { job: { ...job, state: "executing" } };
    }
    return { job };
  });
  if ("carried" in ready) return ready.carried;
  const { job } = ready;
  const asked = job.batchId === null ? await askPayPal(deps, context, job) : { batchId: job.batchId };
  if ("carried" in asked) return asked.carried;
  return readBack(deps, context, job, asked.batchId);
}

/**
 * Asks PayPal to pay. An answer is the batch, never proof of payment. A
 * refusal means PayPal made nothing, so the payment fails and her money stays
 * in the Purse. No answer means Kin cannot know: the payment becomes unknown,
 * and the same key is sent again on the next turn.
 */
async function askPayPal(deps: PurseDeps, context: PurseContext, job: PurseJob): Promise<{ readonly batchId: string } | { readonly carried: Carried }> {
  if (job.receiver === null) throw new Error("A Purse payment reached PayPal without a receiver");
  try {
    const { batchId } = await deps.pool.createPayout(
      { senderBatchId: job.idempotencyKey, receiver: job.receiver, amount: { cents: job.cents, currency: context.currency }, note: "A gift sent through Kin" },
      job.idempotencyKey,
    );
    await asService(deps.db, context.circleId, (tx) => recordPurseSubmitted(tx, job, batchId, deps.now()));
    return { batchId };
  } catch (error) {
    const refused = error instanceof PayoutNotSendableError ? `not_sent_${error.reason}` : error instanceof PayPalError && error.outcome === "rejected" ? `paypal_${error.status ?? "refused"}` : null;
    if (refused === null && !(error instanceof PayPalError)) throw error;
    await asService(deps.db, context.circleId, async (tx) => {
      await recordPurseSubmitted(tx, job, null, deps.now());
      if (refused !== null) await failPursePayment(tx, context, job, refused);
      else await recordPurseUnknown(tx, context, job);
    });
    return { carried: refused === null ? "waiting" : "failed" };
  }
}

/** Reads the batch back from PayPal: the record that decides what happened. */
async function readBack(deps: PurseDeps, context: PurseContext, job: PurseJob, batchId: string): Promise<Carried> {
  let batch;
  try {
    batch = await deps.pool.getPayoutBatch(batchId);
  } catch (error) {
    if (error instanceof PayPalError && error.outcome === "unavailable") return "waiting";
    throw error;
  }
  const item = batch.items[0];
  // A batch that is not this payment's would be someone else's money: stop.
  if (batch.senderBatchId !== job.idempotencyKey || item === undefined || item.amount.cents !== job.cents || item.amount.currency !== context.currency) {
    throw new Error(`Payout batch ${batchId} does not match Purse payment ${job.paymentId}`);
  }
  return asService(deps.db, context.circleId, async (tx): Promise<Carried> => {
    const locked = await lockPurseJob(tx, context.circleId, job.paymentId);
    if (locked === null) return "waiting";
    const outcome = payoutOutcome(item.status);
    if (outcome === "confirmed") {
      await confirmPursePayment(tx, context, locked, { itemId: item.itemId, batchId, feeCents: item.fee?.cents ?? 0, at: deps.now() });
      return "paid";
    }
    if (outcome === "failed") {
      await failPursePayment(tx, context, locked, `paypal_${item.status.toLowerCase()}`);
      return "failed";
    }
    return "waiting";
  });
}

/**
 * The nightly reconciliation of Purse payouts against PayPal's own record
 * (docs/architecture.md section 8.8): each real payment recorded as paid more
 * than three hours ago is looked up in Transaction Search. A match for the same
 * amount out of the pool marks it reconciled; a record that disagrees is put in
 * the audit log for a person and never corrected by itself; nothing found yet
 * is looked for again next time. Demo circles' payments are simulated and have
 * nothing to reconcile.
 */
export async function reconcilePurse(deps: PurseDeps, log: InboxLog): Promise<{ readonly reconciled: number; readonly mismatched: number }> {
  let reconciled = 0;
  let mismatched = 0;
  for (const circleId of await purseCircles(deps.db)) {
    const due = await asService(deps.db, circleId, (tx) => readUnreconciledPurse(tx, circleId));
    for (const payment of due) {
      if (deps.now().getTime() - payment.paidAt.getTime() < RECONCILE_AFTER_MS) continue;
      const found = await deps.pool.getPayoutTransaction(payment.itemId, payment.paidAt);
      if (found === null) continue;
      if (leftThePool(found) && -found.amountCents === payment.cents) {
        await asService(deps.db, circleId, (tx) => recordPurseReconciled(tx, circleId, payment.paymentId, deps.now()));
        reconciled += 1;
      } else {
        await asService(deps.db, circleId, (tx) => recordPurseMismatch(tx, circleId, payment.paymentId, `paypal_${found.status.toLowerCase()}_${found.amountCents}`));
        log({ level: "error", message: "purse.reconcile_mismatch", circleId, paymentId: payment.paymentId });
        mismatched += 1;
      }
    }
  }
  return { reconciled, mismatched };
}

// Never a database error's message: it can quote the query's values (AGENTS.md section 6).
function describe(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { name: "unknown" };
  if (!(error instanceof PayPalError)) return { name: error.name };
  return { name: error.name, outcome: error.outcome, status: error.status, issue: error.issue, debugId: error.debugId };
}
