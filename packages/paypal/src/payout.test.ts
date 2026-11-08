import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createPayPalClient, type Fetch } from "./client.ts";
import { PayPalShapeError } from "./json.ts";
import { PAYOUT_ITEM_STATUSES, PayoutNotSendableError, parsePayoutBatch, payoutBody, payoutOutcome, payoutRecipient, type NewPayout } from "./payout.ts";
import { paypalPool } from "./pool.ts";

type Recording = { created: unknown; duplicate: unknown; pending: unknown; succeeded: unknown };
const recording = JSON.parse(readFileSync(new URL("./fixtures/payout-sandbox-2026-10-26.json", import.meta.url), "utf8")) as Recording;
type VenmoRecording = { created: unknown; unclaimed: unknown; succeeded: unknown; returned: unknown; failed: unknown };
// Derived from PayPal's documentation, not recorded: see fixtures/README.md.
// Recorded from the PayPal sandbox on 8 November 2026: the sandbox refuses the Venmo wallet itself.
const venmoRefused = (JSON.parse(readFileSync(new URL("./fixtures/payout-venmo-sandbox-refused-2026-11-08.json", import.meta.url), "utf8")) as { refusals: Record<string, { httpStatus: number; body: unknown }> }).refusals["venmo-email"];
const venmoRecording = JSON.parse(readFileSync(new URL("./fixtures/payout-venmo-documented-2026-11-08.json", import.meta.url), "utf8")) as VenmoRecording;
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
      { itemId: expect.stringMatching(/^[A-Z0-9]+$/), status: "SUCCESS", transactionId: expect.any(String), amount: { cents: 100, currency: "USD" }, fee: { cents: 25, currency: "USD" }, senderItemId: expect.stringMatching(/^kin-payout-verify-/), wallet: "PAYPAL" },
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

const venmo: NewPayout = { senderBatchId: "kin-payout-venmo-0b6f4c3e", receiver: "+15555550123", amount: { cents: 4_800, currency: "USD" }, note: "Payment for your care shift, approved by the family in Kin", wallet: "VENMO" };

describe("which address a receiver is", () => {
  it("takes an email for either wallet", () => {
    expect(payoutRecipient("caregiver@example.com", "PAYPAL")).toEqual({ recipientType: "EMAIL", value: "caregiver@example.com" });
    expect(payoutRecipient(" caregiver@example.com ", "VENMO")).toEqual({ recipientType: "EMAIL", value: "caregiver@example.com" });
  });

  it("takes a US mobile number for Venmo, however it was written, and sends it as +1 and ten digits", () => {
    for (const written of ["+15555550123", "+1 (555) 555-0123", "555-555-0123", "1 555 555 0123", "5555550123"]) {
      expect(payoutRecipient(written, "VENMO")).toEqual({ recipientType: "PHONE", value: "+15555550123" });
    }
  });

  it("takes an @handle for Venmo and keeps its @", () => {
    expect(payoutRecipient("@amara-k_1", "VENMO")).toEqual({ recipientType: "USER_HANDLE", value: "@amara-k_1" });
  });

  it("refuses, for good, anything else, and a phone or handle for a PayPal wallet", () => {
    const refused: [string, "PAYPAL" | "VENMO"][] = [
      ["+15555550123", "PAYPAL"], ["@amara", "PAYPAL"],
      ["amara", "VENMO"], ["", "VENMO"], ["@", "VENMO"], ["@ab", "VENMO"], ["@has space", "VENMO"], ["@" + "a".repeat(31), "VENMO"],
      ["+447700900123", "VENMO"], ["555-0123", "VENMO"], ["22345678901", "VENMO"], ["555-555-0123 ext 4", "VENMO"], ["not an email@", "VENMO"],
    ];
    for (const [receiver, wallet] of refused) {
      expect(() => payoutRecipient(receiver, wallet), `${wallet} ${receiver}`).toThrow(PayoutNotSendableError);
    }
    expect(() => payoutRecipient("amara", "VENMO")).toThrowError(expect.objectContaining({ retryable: false, reason: "invalid_receiver" }));
  });

  it("never puts the receiver in the error", () => {
    try {
      payoutRecipient("+15555550999x", "VENMO");
    } catch (error) {
      expect(String(error)).not.toContain("5555550999");
    }
  });
});

describe("a Venmo payout", () => {
  it("asks PayPal for the Venmo wallet, the receiver's type and a private feed, in USD", () => {
    expect(JSON.parse(payoutBody(venmo))).toEqual({
      sender_batch_header: { sender_batch_id: venmo.senderBatchId, recipient_type: "PHONE", email_subject: "You have a payment from Kin", email_message: venmo.note },
      items: [
        {
          recipient_type: "PHONE", receiver: "+15555550123", amount: { currency: "USD", value: "48.00" }, note: venmo.note, sender_item_id: venmo.senderBatchId,
          recipient_wallet: "VENMO", application_context: { social_feed_privacy: "PRIVATE" },
        },
      ],
    });
  });

  it("names a handle and an email by their type", () => {
    expect(JSON.parse(payoutBody({ ...venmo, receiver: "@amara" })).items[0]).toMatchObject({ recipient_type: "USER_HANDLE", receiver: "@amara", recipient_wallet: "VENMO" });
    expect(JSON.parse(payoutBody({ ...venmo, receiver: "amara@example.com" })).items[0]).toMatchObject({ recipient_type: "EMAIL", recipient_wallet: "VENMO" });
  });

  it("leaves a PayPal payout exactly as it was: no wallet, no application context", () => {
    expect(JSON.parse(payoutBody({ ...payout, wallet: "PAYPAL" }))).toEqual(JSON.parse(payoutBody(payout)));
    expect(payoutBody(payout)).not.toContain("recipient_wallet");
  });

  it("is not sent in any currency but USD, and not without a note", () => {
    expect(() => payoutBody({ ...venmo, amount: { cents: 4_800, currency: "EUR" } })).toThrowError(expect.objectContaining({ reason: "venmo_usd_only", retryable: false }));
    expect(() => payoutBody({ ...venmo, note: "  " })).toThrowError(expect.objectContaining({ reason: "venmo_note_required" }));
    // A PayPal wallet still pays in any currency the pool holds.
    expect(() => payoutBody({ ...payout, amount: { cents: 4_800, currency: "EUR" } })).not.toThrow();
  });

  it("sends nothing to PayPal when the payout cannot be sent", async () => {
    const { pool, sent } = poolAnswering([]);
    await expect(pool.createPayout({ ...venmo, amount: { cents: 100, currency: "EUR" } }, "kin-payout-venmo-0b6f4c3e")).rejects.toBeInstanceOf(PayoutNotSendableError);
    expect(sent).toHaveLength(0);
  });

  it("posts the Venmo body with the execution's key", async () => {
    const { pool, sent } = poolAnswering([{ status: 201, body: venmoRecording.created }]);
    expect(await pool.createPayout(venmo, "kin-payout-venmo-0b6f4c3e")).toEqual({ batchId: "VENMOBATCH01" });
    expect(new Headers(sent[0]?.init.headers).get("PayPal-Request-Id")).toBe("kin-payout-venmo-0b6f4c3e");
    expect(JSON.parse(String(sent[0]?.init.body)).items[0].recipient_wallet).toBe("VENMO");
  });

  it("is refused for good, and asked once, when the sandbox does not support the Venmo wallet (recorded 8 November 2026)", async () => {
    if (!venmoRefused) throw new Error("The fixture has no refusal");
    const { pool, sent } = poolAnswering([{ status: venmoRefused.httpStatus, body: venmoRefused.body }, { status: venmoRefused.httpStatus, body: venmoRefused.body }]);
    await expect(pool.createPayout(venmo, "kin-payout-venmo-0b6f4c3e")).rejects.toMatchObject({ outcome: "rejected", retryable: false, status: 400, issue: "Recipient wallet not supported in sandbox." });
    expect(sent).toHaveLength(1);
  });

  it("reads the wallet back with an item that is unclaimed, paid, returned or failed", () => {
    const read = (value: unknown) => parsePayoutBatch(value).items[0];
    expect(read(venmoRecording.unclaimed)).toMatchObject({ status: "UNCLAIMED", wallet: "VENMO", transactionId: null, fee: null, amount: { cents: 4_800, currency: "USD" } });
    expect(read(venmoRecording.succeeded)).toMatchObject({ status: "SUCCESS", wallet: "VENMO", fee: { cents: 25, currency: "USD" } });
    expect(read(venmoRecording.returned)).toMatchObject({ status: "RETURNED", wallet: "VENMO" });
    expect(read(venmoRecording.failed)).toMatchObject({ status: "FAILED", wallet: "VENMO" });
    expect(parsePayoutBatch(venmoRecording.succeeded).senderBatchId).toBe(venmo.senderBatchId);
  });

  it("reads the wallet whatever its casing, and as unknown when PayPal says nothing or something new", () => {
    const withWallet = (wallet: unknown) => {
      const copy = structuredClone(venmoRecording.succeeded) as { items: { payout_item: Record<string, unknown> }[] };
      const [item] = copy.items;
      if (!item) throw new Error("The fixture has no item");
      if (wallet === undefined) delete item.payout_item["recipient_wallet"];
      else item.payout_item["recipient_wallet"] = wallet;
      return parsePayoutBatch(copy).items[0]?.wallet;
    };
    expect(withWallet("Venmo")).toBe("VENMO");
    expect(withWallet(undefined)).toBeNull();
    expect(withWallet("CRYPTO")).toBeNull();
  });

  it("waits on an unclaimed Venmo item and fails a returned or failed one, as for any payout", () => {
    const outcome = (value: unknown) => payoutOutcome(parsePayoutBatch(value).items[0]?.status ?? "OTHER");
    expect([outcome(venmoRecording.unclaimed), outcome(venmoRecording.succeeded), outcome(venmoRecording.returned), outcome(venmoRecording.failed)]).toEqual(["waiting", "confirmed", "failed", "failed"]);
  });
});
