import { readDatabaseConfig, readInboxConfig, readPayPalConfig, readSandboxPayoutConfig, readShiftCallConfig } from "@kin/config";
import { connect } from "@kin/db";
import { payoutFeeReserve, poolFor, sqsInbox } from "@kin/paypal";
import { createTwilioOutboundCaller } from "@kin/telephony";

import { runInboxBatch, type InboxLog } from "./paypal-inbox/run-inbox.ts";
import { runPayoutBatch } from "./payouts/run-payouts.ts";
import { dailyBudget } from "./payouts/sandbox-route.ts";
import { httpMerchant, simulatedMerchant } from "./purchases/merchant.ts";
import { runDeliveryBatch, runPurchaseBatch } from "./purchases/run-purchases.ts";
import { runReceiptBatch } from "./receipts/run-receipts.ts";
import { runCallBatch } from "./shifts/run-calls.ts";
import { runCreditBatch } from "./shifts/run-credits.ts";
import { runSettleBatch } from "./shifts/run-settles.ts";

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
/** The same, for approved receipts. */
const RECEIPT_POLL_MS = 5_000;
/** The same, for confirmed visits to be credited as care time. */
const CREDIT_POLL_MS = 5_000;
/** The same, for confirmed shifts to be settled and for the parent's call to be placed. */
const SETTLE_POLL_MS = 5_000;
const CALL_POLL_MS = 5_000;

const log: InboxLog = (line) => console.log(JSON.stringify({ at: new Date().toISOString(), ...line }));

const paypal = readPayPalConfig(process.env, { webhook: true });
const inboxConfig = readInboxConfig(process.env);
// Demo caregiver payouts paid for real through PayPal's sandbox, to Kin's own test account, when one is named.
const sandboxPayouts = readSandboxPayoutConfig(process.env);
// Kin's call to the parent needs a Twilio account and the phone service's address; without them it stays off.
const shiftCalls = readShiftCallConfig(process.env);
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

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const sandbox = sandboxPayouts.enabled ? { payeeEmail: sandboxPayouts.payeeEmail, dailyLimit: sandboxPayouts.dailyLimit, budget: dailyBudget() } : null;
  const payouts = { ...deps, now: () => new Date(), feeReserve: (currency: string) => payoutFeeReserve(currency)(), sandbox };
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

// Approved receipts, credited to the member who spent the money.
async function receiptLoop(): Promise<void> {
  const receipts = { db: deps.db, now: () => new Date() };
  while (running) {
    try {
      if ((await runReceiptBatch(receipts, log)) === 0) await pause(RECEIPT_POLL_MS);
    } catch (error) {
      log({ level: "error", message: "receipt.claim_failed", error: error instanceof Error ? error.name : "unknown" });
      await pause(PAUSE_AFTER_ERROR_MS);
    }
  }
}

// Confirmed visits and drives by siblings, credited as care time toward their fair share.
async function creditLoop(): Promise<void> {
  const credits = { db: deps.db };
  while (running) {
    try {
      if ((await runCreditBatch(credits, log)) === 0) await pause(CREDIT_POLL_MS);
    } catch (error) {
      log({ level: "error", message: "shift_credit.claim_failed", error: error instanceof Error ? error.name : "unknown" });
      await pause(PAUSE_AFTER_ERROR_MS);
    }
  }
}

// Confirmed shifts nobody is at the keyboard to settle: a check-out by link, the parent's word by phone.
async function settleLoop(): Promise<void> {
  const settles = { db: deps.db };
  while (running) {
    try {
      if ((await runSettleBatch(settles, log)) === 0) await pause(SETTLE_POLL_MS);
    } catch (error) {
      log({ level: "error", message: "shift_settle.claim_failed", error: error instanceof Error ? error.name : "unknown" });
      await pause(PAUSE_AFTER_ERROR_MS);
    }
  }
}

// Kin's call to the parent for the family's word on a visit. Messages stay queued while the loop is off.
async function callLoop(config: Extract<typeof shiftCalls, { enabled: true }>): Promise<void> {
  const caller = createTwilioOutboundCaller({ accountSid: config.accountSid, authToken: config.authToken, from: config.callerNumber });
  const calls = { db: deps.db, caller, publicUrl: config.publicUrl, tokenKey: config.tokenKey, now: () => new Date(), pause };
  while (running) {
    try {
      if ((await runCallBatch(calls, log)) === 0) await pause(CALL_POLL_MS);
    } catch (error) {
      log({ level: "error", message: "shift_call.claim_failed", error: error instanceof Error ? error.name : "unknown" });
      await pause(PAUSE_AFTER_ERROR_MS);
    }
  }
}

log({ level: "info", message: "worker.started" });
if (!shiftCalls.enabled) log({ level: "info", message: "shift_call.disabled", missing: shiftCalls.missing.join(",") });
await Promise.all([inboxLoop(), payoutLoop(), purchaseLoop(), receiptLoop(), creditLoop(), settleLoop(), ...(shiftCalls.enabled ? [callLoop(shiftCalls)] : [])]);
await deps.db.$client.end();
log({ level: "info", message: "worker.stopped" });
