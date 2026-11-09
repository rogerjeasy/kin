import { readDatabaseConfig, readInboxConfig, readPayPalConfig, readPresenceTextConfig, readSandboxPayoutConfig, readShiftCallConfig } from "@kin/config";
import { connect } from "@kin/db";
import { payoutFeeReserve, poolFor, sqsInbox } from "@kin/paypal";
import { createTwilioTextSender } from "@kin/notify";
import { createTwilioOutboundCaller } from "@kin/telephony";

import { runInboxBatch, type InboxLog } from "./paypal-inbox/run-inbox.ts";
import { runPresenceCalls } from "./presence/place-presence-call.ts";
import { runPresenceBatch, runPresenceSweep } from "./presence/run-presence.ts";
import { runPayoutBatch } from "./payouts/run-payouts.ts";
import { dailyBudget } from "./payouts/sandbox-route.ts";
import { httpMerchant, simulatedMerchant } from "./purchases/merchant.ts";
import { runDeliveryBatch, runPurchaseBatch } from "./purchases/run-purchases.ts";
import { runReceiptBatch } from "./receipts/run-receipts.ts";
import { runCallBatch } from "./shifts/run-calls.ts";
import { runCreditBatch } from "./shifts/run-credits.ts";
import { runSettleBatch } from "./shifts/run-settles.ts";
import { runWishSubscriptionBatch } from "./wishes/run-subscriptions.ts";

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
/** The same, for "is it really you?" texts: a person is waiting on the line for the answer, so it is looked at often. */
const PRESENCE_POLL_MS = 2_000;
/** The same, for the subscriptions the parent's wishes suspend and resume through PayPal. */
const WISH_SUBSCRIPTION_POLL_MS = 15_000;

const log: InboxLog = (line) => console.log(JSON.stringify({ at: new Date().toISOString(), ...line }));

const paypal = readPayPalConfig(process.env, { webhook: true });
const inboxConfig = readInboxConfig(process.env);
// Demo caregiver payouts paid for real through PayPal's sandbox, to Kin's own test account, when one is named.
const sandboxPayouts = readSandboxPayoutConfig(process.env);
// Kin's call to the parent needs a Twilio account and the phone service's address; without them it stays off.
const shiftCalls = readShiftCallConfig(process.env);
// The "is it really you?" texts need a Twilio account, a sender and the web app's address; without them they stay queued.
const presenceTexts = readPresenceTextConfig(process.env);
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

// Texts to a family member: "is this you?" for a pressured call, and the link that confirms their number.
async function presenceTextLoop(config: Extract<typeof presenceTexts, { enabled: true }>): Promise<void> {
  const texts = createTwilioTextSender({ accountSid: config.accountSid, authToken: config.authToken, sender: config.sender });
  const presence = { db: deps.db, texts, webUrl: config.webUrl };
  while (running) {
    try {
      if ((await runPresenceBatch(presence, log)) === 0) await pause(PRESENCE_POLL_MS);
    } catch (error) {
      log({ level: "error", message: "presence.claim_failed", error: error instanceof Error ? error.name : "unknown" });
      await pause(PAUSE_AFTER_ERROR_MS);
    }
  }
}

// Checks whose ninety seconds ran out, or whose link did: the family is told, and the hold on outgoing money ends.
async function presenceSweepLoop(): Promise<void> {
  while (running) {
    try {
      await runPresenceSweep(deps.db, log);
    } catch (error) {
      log({ level: "error", message: "presence.sweep_failed", error: error instanceof Error ? error.name : "unknown" });
    }
    await pause(PRESENCE_POLL_MS);
  }
}

// Kin's call to the real person when their text went unanswered for thirty seconds. It needs the shift call's Twilio settings.
async function presenceCallLoop(config: Extract<typeof shiftCalls, { enabled: true }>): Promise<void> {
  const caller = createTwilioOutboundCaller({ accountSid: config.accountSid, authToken: config.authToken, from: config.callerNumber });
  const calls = { db: deps.db, caller, publicUrl: config.publicUrl, tokenKey: config.tokenKey, now: () => new Date() };
  while (running) {
    try {
      await runPresenceCalls(calls, log);
    } catch (error) {
      log({ level: "error", message: "presence.call_loop_failed", error: error instanceof Error ? error.name : "unknown" });
    }
    await pause(PRESENCE_POLL_MS);
  }
}

// The subscriptions a trigger suspends, and resumes when the parent is home, through PayPal. A demo circle's never queue.
async function wishSubscriptionLoop(): Promise<void> {
  const subscriptions = { db: deps.db, pool: deps.pool, now: () => new Date() };
  while (running) {
    try {
      if ((await runWishSubscriptionBatch(subscriptions, log)) === 0) await pause(WISH_SUBSCRIPTION_POLL_MS);
    } catch (error) {
      log({ level: "error", message: "wish_subscription.claim_failed", error: error instanceof Error ? error.name : "unknown" });
      await pause(PAUSE_AFTER_ERROR_MS);
    }
  }
}

log({ level: "info", message: "worker.started" });
if (!shiftCalls.enabled) log({ level: "info", message: "shift_call.disabled", missing: shiftCalls.missing.join(",") });
if (!presenceTexts.enabled) log({ level: "info", message: "presence_text.disabled", missing: presenceTexts.missing.join(",") });
await Promise.all([
  inboxLoop(),
  payoutLoop(),
  purchaseLoop(),
  receiptLoop(),
  creditLoop(),
  settleLoop(),
  presenceSweepLoop(),
  wishSubscriptionLoop(),
  ...(shiftCalls.enabled ? [callLoop(shiftCalls), presenceCallLoop(shiftCalls)] : []),
  ...(presenceTexts.enabled ? [presenceTextLoop(presenceTexts)] : []),
]);
await deps.db.$client.end();
log({ level: "info", message: "worker.stopped" });
