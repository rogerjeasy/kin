import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createPayPalClient, type Fetch } from "./client.ts";
import { PayPalShapeError } from "./json.ts";
import { PAYOUT_ITEM_STATUSES, parsePayoutBatch, payoutBody, payoutOutcome } from "./payout.ts";
import { paypalPool } from "./pool.ts";

type Recording = { created: unknown; duplicate: unknown; pending: unknown; succeeded: unknown };
const recording = JSON.parse(readFileSync(new URL("./fixtures/payout-sandbox-2026-10-26.json", import.meta.url), "utf8")) as Recording;
const payout = { senderBatchId: "kin-payout-0b6f4c3e", receiver: "caregiver@example.com", amount: { cents: 26_400, currency: "USD" }, note: "Amara’s bill for completed visits" };

/** The pool over a client whose PayPal answers with `replies`, in order. */
function poolAnswering(replies: { status: number; body: unknown }[]) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetch: Fetch = async (url, init) => {
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token", expires_in: 32_400 });
    sent.push({ url, init });
    const reply = replies.shift();
    if (!reply) throw new Error(`Unexpected call to ${url}`);
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  };
  const client = createPayPalClient({ apiUrl: "https://paypal.test", clientId: "id", clientSecret: "secret", fetch, now: () => new Date("2026-10-26T21:00:00Z"), sleep: async () => {}, log: () => {} });
  return { pool: paypalPool(client, "webhook"), sent };
}

describe("a payout from the pool", () => {
  it("asks PayPal for one item to one email address, with the execution's key as batch and item ID", () => {
    expect(JSON.parse(payoutBody(payout))).toEqual({
      sender_batch_header: { sender_batch_id: payout.senderBatchId, recipient_type: "EMAIL", email_subject: "You have a payment from Kin", email_message: payout.note },
      items: [{ recipient_type: "EMAIL", receiver: "caregiver@example.com", amount: { currency: "USD", value: "264.00" }, note: payout.note, sender_item_id: payout.senderBatchId }],
    });
  });

  it("sends the request ID with the batch, and returns the batch PayPal made", async () => {
    const { pool, sent } = poolAnswering([{ status: 201, body: recording.created }]);
    expect(await pool.createPayout(payout, "kin-payout-0b6f4c3e")).toEqual({ batchId: "TW3HTYB8F9DX2" });
    expect(new Headers(sent[0]?.init.headers).get("PayPal-Request-Id")).toBe("kin-payout-0b6f4c3e");
  });

  it("recovers the batch already made when PayPal refuses a batch ID it has seen, as the sandbox did", async () => {
    const { pool } = poolAnswering([{ status: 400, body: recording.duplicate }]);
    expect(await pool.createPayout(payout, "kin-payout-0b6f4c3e")).toEqual({ batchId: "TW3HTYB8F9DX2" });
  });

  it("passes on any other refusal, even one that links somewhere", async () => {
    const elsewhere = { name: "VALIDATION_ERROR", details: [{ issue: "RECEIVER_UNREGISTERED", link: [{ href: "https://api.sandbox.paypal.com/v1/payments/payouts-item/ABCDE" }] }] };
    for (const reply of [{ status: 422, body: { name: "INSUFFICIENT_FUNDS" } }, { status: 400, body: elsewhere }]) {
      const { pool } = poolAnswering([reply]);
      await expect(pool.createPayout(payout, "kin-payout-0b6f4c3e")).rejects.toMatchObject({ outcome: "rejected" });
    }
  });

  it("reads a pending batch, and the same batch once its item succeeded, in integer cents", () => {
    expect(parsePayoutBatch(recording.pending)).toMatchObject({ batchId: "TW3HTYB8F9DX2", items: [{ status: "PENDING", amount: { cents: 100, currency: "USD" } }] });
    const done = parsePayoutBatch(recording.succeeded);
    // The batch still said PROCESSING when its only item had succeeded: Kin reads the item.
    expect(done.batchStatus).toBe("PROCESSING");
    expect(done.items).toEqual([
      { itemId: expect.stringMatching(/^[A-Z0-9]+$/), status: "SUCCESS", transactionId: expect.any(String), amount: { cents: 100, currency: "USD" }, fee: { cents: 25, currency: "USD" }, senderItemId: expect.stringMatching(/^kin-payout-verify-/) },
    ]);
    expect(done.senderBatchId).toBe(done.items[0]?.senderItemId);
  });

  it("refuses an amount it cannot read exactly", () => {
    const broken = structuredClone(recording.succeeded) as { items: { payout_item: { amount: { value: string } } }[] };
    const [item] = broken.items;
    if (!item) throw new Error("The fixture has no item");
    item.payout_item.amount.value = "1.005";
    expect(() => parsePayoutBatch(broken)).toThrow(PayPalShapeError);
  });

  it("confirms only a successful item, waits on pending, unclaimed or held money, and fails the rest", () => {
    const outcomes = Object.fromEntries([...PAYOUT_ITEM_STATUSES, "OTHER" as const].map((status) => [status, payoutOutcome(status)]));
    expect(outcomes).toEqual({
      SUCCESS: "confirmed",
      PENDING: "waiting", UNCLAIMED: "waiting", ONHOLD: "waiting", OTHER: "waiting",
      FAILED: "failed", RETURNED: "failed", BLOCKED: "failed", REFUNDED: "failed", REVERSED: "failed",
    });
  });
});
