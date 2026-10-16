import type { Inbox, InboxMessage, Received } from "@kin/paypal";
import { describe, expect, it } from "vitest";

import type { InboxDeps } from "./handle-message.ts";
import { runInboxBatch, type InboxLog } from "./run-inbox.ts";

function inboxOf(received: Received[]): Inbox & { removed: string[] } {
  const removed: string[] = [];
  return { removed, send: async () => undefined, receive: async () => received, remove: async (receipt) => void removed.push(receipt) };
}

// A webhook whose body is not JSON is handled without touching the pool or the database.
const unreadable: InboxMessage = { kind: "webhook", delivery: { body: "not json", headers: { "paypal-auth-algo": "a", "paypal-cert-url": "c", "paypal-transmission-id": "t", "paypal-transmission-sig": "s", "paypal-transmission-time": "now" } } };
const unreachable = {
  db: {} as InboxDeps["db"],
  pool: {
    getOrder: async () => Promise.reject(Object.assign(new Error("PayPal down"), { name: "PayPalError" })),
  } as unknown as InboxDeps["pool"],
};

describe("one round of the inbox", () => {
  it("removes what it handled and what nobody could ever read", async () => {
    const inbox = inboxOf([
      { message: unreadable, receipt: "handled" },
      { message: null, receipt: "garbage" },
    ]);
    const lines: Parameters<InboxLog>[0][] = [];
    expect(await runInboxBatch(inbox, unreachable, (line) => lines.push(line))).toBe(2);
    expect(inbox.removed).toEqual(["handled", "garbage"]);
    expect(lines.map((line) => line.message)).toEqual(["inbox.unreadable", "inbox.unreadable_message"]);
  });

  it("leaves a message that failed on the queue, to come back, and logs no message text", async () => {
    const inbox = inboxOf([{ message: { kind: "order_captured", circleId: "0b6f4c3e-8d1a-4f6e-9c2b-5a7d3e1f9a40", orderId: "ORDER12345" }, receipt: "failing" }]);
    const lines: Parameters<InboxLog>[0][] = [];
    await runInboxBatch(inbox, unreachable, (line) => lines.push(line));
    expect(inbox.removed).toEqual([]);
    expect(lines).toEqual([{ level: "error", message: "inbox.retry", kind: "order_captured", error: { name: "PayPalError" } }]);
  });
});
