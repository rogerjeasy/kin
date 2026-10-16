import { inboxGroup, type Inbox } from "@kin/paypal";

import { handleInboxMessage, type InboxDeps, type InboxOutcome } from "./handle-message.ts";

export type InboxLog = (line: { readonly level: "info" | "error"; readonly message: string } & Readonly<Record<string, unknown>>) => void;

/**
 * Handles one batch from the queue. A handled message is removed. A message
 * that throws stays, returns after the queue's visibility timeout, and after
 * five tries lands on the dead-letter queue, which alarms. Once a message of
 * a circle fails, the rest of that circle's batch waits too, so its events
 * are never applied out of order.
 */
export async function runInboxBatch(inbox: Inbox, deps: InboxDeps, log: InboxLog): Promise<number> {
  const batch = await inbox.receive();
  const held = new Set<string>();
  for (const { message, receipt } of batch) {
    if (message === null) {
      log({ level: "error", message: "inbox.unreadable_message" });
      await inbox.remove(receipt);
      continue;
    }
    const group = inboxGroup(message);
    if (held.has(group)) continue;
    try {
      const outcome = await handleInboxMessage(deps, message);
      log(lineFor(message.kind, outcome));
      await inbox.remove(receipt);
    } catch (error) {
      held.add(group);
      log({ level: "error", message: "inbox.retry", kind: message.kind, error: describe(error) });
    }
  }
  return batch.length;
}

function lineFor(kind: string, outcome: InboxOutcome) {
  const level = outcome.result === "failed" || outcome.result === "rejected" ? ("error" as const) : ("info" as const);
  return { level, message: `inbox.${outcome.result}`, kind, ...outcome };
}

// The error's kind and PayPal's debug ID, never a body, token or personal detail.
function describe(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { name: "unknown" };
  const { name, message } = error;
  const debugId = (error as { debugId?: unknown }).debugId;
  return { name, message, ...(typeof debugId === "string" ? { debugId } : {}) };
}
