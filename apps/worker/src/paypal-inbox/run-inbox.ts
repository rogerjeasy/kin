import { PayPalError, type Inbox } from "@kin/paypal";

import { handleInboxMessage, type InboxDeps, type InboxOutcome } from "./handle-message.ts";

export type InboxLog = (line: { readonly level: "info" | "error"; readonly message: string } & Readonly<Record<string, unknown>>) => void;

/**
 * Handles what the queue hands out: one message at a time (see `sqsInbox`).
 * A handled message is removed. A message that throws stays, returns after
 * the queue's visibility timeout, and after five tries lands on the
 * dead-letter queue, which alarms. While it waits, the FIFO queue holds its
 * circle's later messages back, so a circle's events are never applied out
 * of order, and other circles carry on.
 */
export async function runInboxBatch(inbox: Inbox, deps: InboxDeps, log: InboxLog): Promise<number> {
  const batch = await inbox.receive();
  for (const { message, receipt } of batch) {
    if (message === null) {
      log({ level: "error", message: "inbox.unreadable_message" });
      await inbox.remove(receipt);
      continue;
    }
    try {
      const outcome = await handleInboxMessage(deps, message);
      log(lineFor(message.kind, outcome));
      await inbox.remove(receipt);
    } catch (error) {
      log({ level: "error", message: "inbox.retry", kind: message.kind, error: describe(error) });
    }
  }
  return batch.length;
}

function lineFor(kind: string, outcome: InboxOutcome) {
  const level = outcome.result === "failed" || outcome.result === "rejected" ? ("error" as const) : ("info" as const);
  return { level, message: `inbox.${outcome.result}`, kind, ...outcome };
}

// The error's kind and, for PayPal's errors, what PayPal said and its debug
// ID. Never a message from elsewhere: a database error's message can quote
// the query's values, such as a stored webhook body (AGENTS.md section 6).
function describe(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { name: "unknown" };
  if (!(error instanceof PayPalError)) return { name: error.name };
  return { name: error.name, outcome: error.outcome, status: error.status, issue: error.issue, debugId: error.debugId };
}
