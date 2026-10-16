import { readDatabaseConfig, readInboxConfig, readPayPalConfig } from "@kin/config";
import { connect } from "@kin/db";
import { poolFor, sqsInbox } from "@kin/paypal";

import { runInboxBatch, type InboxLog } from "./paypal-inbox/run-inbox.ts";

/**
 * Kin's worker: it applies PayPal's events to the ledger as Kin's service
 * identity, one circle at a time. It holds the service role; the web app
 * never does (docs/architecture.md decision 38).
 */

// Aurora pauses when idle and took 74 seconds to resume (decision 43).
const CONNECT_TIMEOUT_MS = 90_000;
const PAUSE_AFTER_ERROR_MS = 5_000;

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

log({ level: "info", message: "worker.started" });
while (running) {
  try {
    await runInboxBatch(inbox, deps, log);
  } catch (error) {
    log({ level: "error", message: "inbox.receive_failed", error: error instanceof Error ? error.name : "unknown" });
    await new Promise((resolve) => setTimeout(resolve, PAUSE_AFTER_ERROR_MS));
  }
}
await deps.db.$client.end();
log({ level: "info", message: "worker.stopped" });
