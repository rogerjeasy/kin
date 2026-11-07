import { readDatabaseConfig, readInboxConfig, readPayPalConfig } from "@kin/config";
import { connect } from "@kin/db";
import { payoutFeeReserve, poolFor, sqsInbox } from "@kin/paypal";

import { runInboxBatch, type InboxLog } from "./paypal-inbox/run-inbox.ts";
import { runPayoutBatch } from "./payouts/run-payouts.ts";
import { httpMerchant, simulatedMerchant } from "./purchases/merchant.ts";
import { runDeliveryBatch, runPurchaseBatch } from "./purchases/run-purchases.ts";

/**
 * Kin's worker: it applies PayPal's events to the ledger as Kin's service
 * identity, one circle at a time. It holds the service role; the web app
 * never does (docs/architecture.md decision 38).
 */

// Aurora pauses when idle and took 74 seconds to resume (decision 43).
const CONNECT_TIMEOUT_MS = 90_000;
const PAUSE_AFTER_ERROR_MS = 5_000;
/** How often the outbox is asked for approved payouts when it had none. */
const PAYOUT_POLL_MS = 5_000;
const PURCHASE_POLL_MS = 5_000;

const log: InboxLog = (line) => console.log(JSON.stringify({ at: new Date().toISOString(), ...line }));

const paypal = readPayPalConfig(process.env, { webhook: true });
const inboxConfig = readInboxConfig(process.env);
if (!paypal.enabled || inboxConfig === null) throw new Error("The worker needs the PayPal settings and the inbox queue");

const deps = {
  db: connect(readDatabaseConfig(process.env, ["service"]), "service", { connectTimeoutMs: CONNECT_TIMEOUT_MS }),
  pool: poolFor(paypal, (call) => {
    if (call.status === null || call.status >= 400) log({ level: "error", message: "paypal.call", ...call });
  }),
};
const inbox = sqsInbox(inboxConfig);

let running = true;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log({ level: "info", message: "worker.stopping", signal });
    running = false;
  });
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// PayPal's events, from the inbox queue.
async function inboxLoop(): Promise<void> {
  while (running) {
    try {
      await runInboxBatch(inbox, deps, log);
    } catch (error) {
      log({ level: "error", message: "inbox.receive_failed", error: error instanceof Error ? error.name : "unknown" });
      await pause(PAUSE_AFTER_ERROR_MS);
    }
  }
}

// Approved payouts, from the outbox the approval wrote in its own transaction.
async function payoutLoop(): Promise<void> {
  const payouts = { ...deps, now: () => new Date(), feeReserve: (currency: string) => payoutFeeReserve(currency)() };
  while (running) {
    try {
      if ((await runPayoutBatch(payouts, log)) === 0) await pause(PAYOUT_POLL_MS);
    } catch (error) {
      log({ level: "error", message: "payout.claim_failed", error: error instanceof Error ? error.name : "unknown" });
      await pause(PAUSE_AFTER_ERROR_MS);
    }
  }
}

// Approved refills and the orders on their way. The demo pharmacy service, when one is named, is the seller;
// otherwise the seller is simulated in process, and everything recorded says so.
async function purchaseLoop(): Promise<void> {
  const merchantUrl = process.env["KIN_DEMO_MERCHANT_URL"];
  const purchases = { db: deps.db, merchant: merchantUrl ? httpMerchant(merchantUrl) : simulatedMerchant, now: () => new Date() };
  while (running) {
    try {
      const turns = (await runPurchaseBatch(purchases, log)) + (await runDeliveryBatch(purchases, log));
      if (turns === 0) await pause(PURCHASE_POLL_MS);
    } catch (error) {
      log({ level: "error", message: "purchase.claim_failed", error: error instanceof Error ? error.name : "unknown" });
      await pause(PAUSE_AFTER_ERROR_MS);
    }
  }
}

log({ level: "info", message: "worker.started" });
await Promise.all([inboxLoop(), payoutLoop(), purchaseLoop()]);
await deps.db.$client.end();
log({ level: "info", message: "worker.stopped" });
