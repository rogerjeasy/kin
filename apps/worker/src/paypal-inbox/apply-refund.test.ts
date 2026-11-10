import { asService, readLedger } from "@kin/db";
import { paypalEventStates, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { accountBalance, memberAccount, type Ledger, type LedgerEntry } from "@kin/domain";
import { fakePool, type FakePool } from "@kin/paypal/testing";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { handleInboxMessage, type InboxDeps } from "./handle-message.ts";

const db = testDatabases();

type Paid = { circle: VisitorCircle; pool: FakePool; deps: InboxDeps; captureId: string };

/** Marcus tops up Rose's circle by $25.00, PayPal captures it with a 52-cent fee, and `record` says whether Kin hears of it. */
async function paid(record = true): Promise<Paid> {
  const circle = await visitorWithCircle(db);
  const pool = fakePool();
  const { orderId } = await pool.createOrder(
    { amount: { cents: 2500, currency: "USD" }, reference: { circleId: circle.circleId, memberId: circle.members.marcus }, description: "Top-up", returnUrl: "https://kin.test" },
    `create-${randomUUID()}`,
  );
  pool.approve(orderId);
  const order = await pool.captureOrder(orderId, `capture-${orderId}`);
  const captureId = order.captures[0]?.id;
  if (captureId === undefined) throw new Error("No capture");
  const deps = { db: db.service, pool };
  if (record) await handleInboxMessage(deps, { kind: "order_captured", circleId: circle.circleId, orderId });
  return { circle, pool, deps, captureId };
}

const ledgerOf = (circleId: string) => asService(db.service, circleId, (tx) => readLedger(tx, { id: circleId, currency: "USD" }));
const original = (ledger: Ledger, captureId: string) => ledger.entries.find((entry) => entry.source.id === captureId && entry.reverses === null);
const reversalsOf = (ledger: Ledger, captureId: string): LedgerEntry[] => ledger.entries.filter((entry) => entry.reverses !== null && entry.reverses === original(ledger, captureId)?.id);
const eventStates = (circleId: string) => paypalEventStates(db, circleId);

describe("a refund of a top-up, in the worker's PayPal inbox", () => {
  it("reverses the top-up once PayPal says the whole capture went back with its fee, so the pool and Marcus's share return to before it", async () => {
    const { circle, pool, deps, captureId } = await paid();
    const before = await ledgerOf(circle.circleId);
    const refund = pool.refundCapture(captureId, { feeReturnedCents: 52 });

    const outcome = await handleInboxMessage(deps, { kind: "webhook", delivery: pool.refundEvent(refund.id) });

    expect(outcome).toEqual({ result: "refunded", circleId: circle.circleId, refund: "reversed" });
    const after = await ledgerOf(circle.circleId);
    const [reversal] = reversalsOf(after, captureId);
    expect(reversal).toMatchObject({ kind: "contribution", source: { type: "paypal_event", id: refund.id }, simulated: false, reverses: original(after, captureId)?.id });
    const marcus = memberAccount(circle.members.marcus);
    expect(accountBalance(after, marcus) - accountBalance(before, marcus)).toBe(-2500);
    expect(accountBalance(after, "pool_cash") - accountBalance(before, "pool_cash")).toBe(-(2500 - 52));
    expect(accountBalance(after, "fees") - accountBalance(before, "fees")).toBe(-52);
    expect(await eventStates(circle.circleId)).toEqual([{ eventId: `WH-PAYMENT.CAPTURE.REFUNDED-${refund.id}`, state: "processed" }]);
  });

  it("writes no second entry when the event is redelivered, or PayPal also reports the capture reversed", async () => {
    const { circle, pool, deps, captureId } = await paid();
    const refund = pool.refundCapture(captureId, { feeReturnedCents: 52 });
    const delivery = pool.refundEvent(refund.id);
    await handleInboxMessage(deps, { kind: "webhook", delivery });

    expect(await handleInboxMessage(deps, { kind: "webhook", delivery })).toEqual({ result: "duplicate" });
    const resent = pool.refundEvent(refund.id, "PAYMENT.CAPTURE.REFUNDED", "WH-RESENT");
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: resent })).toEqual({ result: "refunded", circleId: circle.circleId, refund: "already_reversed" });
    const reversed = pool.refundEvent(refund.id, "PAYMENT.CAPTURE.REVERSED");
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: reversed })).toEqual({ result: "refunded", circleId: circle.circleId, refund: "already_reversed" });
    expect(reversalsOf(await ledgerOf(circle.circleId), captureId)).toHaveLength(1);
  });

  it("reverses the top-up on a reversal PayPal made itself, as on a refund", async () => {
    const { circle, pool, deps, captureId } = await paid();
    const reversal = pool.refundCapture(captureId, { feeReturnedCents: 52 });
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: pool.refundEvent(reversal.id, "PAYMENT.CAPTURE.REVERSED") })).toEqual({ result: "refunded", circleId: circle.circleId, refund: "reversed" });
    expect(reversalsOf(await ledgerOf(circle.circleId), captureId)).toHaveLength(1);
  });

  it("holds a partial refund for a person and writes nothing, and then the refund of the rest too", async () => {
    const { circle, pool, deps, captureId } = await paid();
    const before = await ledgerOf(circle.circleId);
    const part = pool.refundCapture(captureId, { cents: 1000 });

    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: pool.refundEvent(part.id) })).toEqual({ result: "failed", circleId: circle.circleId, reason: "partial_refund" });
    const rest = pool.refundCapture(captureId, { feeReturnedCents: 52 });
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: pool.refundEvent(rest.id) })).toEqual({ result: "failed", circleId: circle.circleId, reason: "partial_refund" });

    expect((await ledgerOf(circle.circleId)).entries).toHaveLength(before.entries.length);
    expect(await eventStates(circle.circleId)).toEqual([
      { eventId: `WH-PAYMENT.CAPTURE.REFUNDED-${part.id}`, state: "failed" },
      { eventId: `WH-PAYMENT.CAPTURE.REFUNDED-${rest.id}`, state: "failed" },
    ]);
  });

  it("holds a full refund in which PayPal kept its fee, rather than read more in the pool than PayPal holds", async () => {
    const { circle, pool, deps, captureId } = await paid();
    const before = await ledgerOf(circle.circleId);
    const refund = pool.refundCapture(captureId);
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: pool.refundEvent(refund.id) })).toEqual({ result: "failed", circleId: circle.circleId, reason: "fee_differs" });
    expect((await ledgerOf(circle.circleId)).entries).toHaveLength(before.entries.length);
  });

  it("holds a refund PayPal has not finished", async () => {
    const { circle, pool, deps, captureId } = await paid();
    const refund = pool.refundCapture(captureId, { status: "PENDING", feeReturnedCents: 52 });
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: pool.refundEvent(refund.id) })).toEqual({ result: "failed", circleId: circle.circleId, reason: "not_completed" });
    expect(reversalsOf(await ledgerOf(circle.circleId), captureId)).toEqual([]);
  });

  it("refuses a refund of a capture this circle never recorded, and keeps the event for a person", async () => {
    const { circle, pool, deps, captureId } = await paid(false);
    const refund = pool.refundCapture(captureId, { feeReturnedCents: 52 });
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: pool.refundEvent(refund.id) })).toEqual({ result: "failed", circleId: circle.circleId, reason: "unknown_capture" });
    expect(await eventStates(circle.circleId)).toEqual([{ eventId: `WH-PAYMENT.CAPTURE.REFUNDED-${refund.id}`, state: "failed" }]);
  });

  it("files nothing for a refund of a capture that names no circle Kin has, or a refund PayPal will not show", async () => {
    const { pool, deps, captureId } = await paid();
    const refund = pool.refundCapture(captureId, { feeReturnedCents: 52 });
    const genuine = pool.refundEvent(refund.id);
    const unknown = { ...genuine, body: genuine.body.replace(`captures/${captureId}`, "captures/CAPTURENOTKINS1") };
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: unknown })).toEqual({ result: "unplaced" });
    const unlinked = { ...genuine, body: genuine.body.replace(`captures/${captureId}`, "orders/ORDER1") };
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: unlinked })).toEqual({ result: "unplaced" });
  });

  it("trusts the capture read back from PayPal, not a circle the refund's body claims, and reverses nothing in either circle", async () => {
    const { circle, pool, deps, captureId } = await paid();
    const target = await visitorWithCircle(db);
    const refund = pool.refundCapture(captureId, { feeReturnedCents: 52 });
    const genuine = pool.refundEvent(refund.id);
    const claimed = JSON.parse(genuine.body) as { resource: Record<string, unknown> };
    claimed.resource["custom_id"] = `kin1:${target.circleId}:${target.members.marcus}`;

    const outcome = await handleInboxMessage(deps, { kind: "webhook", delivery: { ...genuine, body: JSON.stringify(claimed) } });

    expect(outcome).toEqual({ result: "failed", circleId: target.circleId, reason: "other_circle" });
    expect(await eventStates(target.circleId)).toEqual([{ eventId: `WH-PAYMENT.CAPTURE.REFUNDED-${refund.id}`, state: "failed" }]);
    expect(reversalsOf(await ledgerOf(circle.circleId), captureId)).toEqual([]);
  });

  it("keeps a refund PayPal will not show for a person, and retries one it cannot reach", async () => {
    const { circle, pool, deps, captureId } = await paid();
    const refund = pool.refundCapture(captureId, { feeReturnedCents: 52 });
    const genuine = pool.refundEvent(refund.id);
    const missing = { ...genuine, body: genuine.body.replace(`"id":"${refund.id}"`, '"id":"REFUNDNOTKNOWN1"') };
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: missing })).toEqual({ result: "failed", circleId: circle.circleId, reason: "unknown_refund" });

    const delivery = pool.refundEvent(refund.id, "PAYMENT.CAPTURE.REFUNDED", "WH-RETRIED");
    pool.failNext = "getRefund";
    await expect(handleInboxMessage(deps, { kind: "webhook", delivery })).rejects.toMatchObject({ outcome: "unavailable", retryable: true });
    expect(reversalsOf(await ledgerOf(circle.circleId), captureId)).toEqual([]);
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery })).toEqual({ result: "refunded", circleId: circle.circleId, refund: "reversed" });
  });

  it("writes nothing from a refund PayPal does not vouch for", async () => {
    const { circle, pool, deps, captureId } = await paid();
    const refund = pool.refundCapture(captureId, { feeReturnedCents: 52 });
    pool.signaturesValid = false;
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: pool.refundEvent(refund.id) })).toMatchObject({ result: "rejected" });
    expect(await eventStates(circle.circleId)).toEqual([]);
    expect(reversalsOf(await ledgerOf(circle.circleId), captureId)).toEqual([]);
  });
});
