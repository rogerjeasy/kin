import { asService, readLedger } from "@kin/db";
import { paypalEventStates, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { accountBalance, memberAccount, type LedgerEntry } from "@kin/domain";
import { fakePool, type FakePool } from "@kin/paypal/testing";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { handleInboxMessage, type InboxDeps } from "./handle-message.ts";

const db = testDatabases();

type Paid = { circle: VisitorCircle; pool: FakePool; deps: InboxDeps; orderId: string; captureId: string };

/** Marcus tops up Rose's circle by `cents`, and PayPal captures it. */
async function paid(cents = 2500, member: keyof VisitorCircle["members"] = "marcus"): Promise<Paid> {
  const circle = await visitorWithCircle(db);
  const pool = fakePool();
  const { orderId } = await pool.createOrder(
    { amount: { cents, currency: "USD" }, reference: { circleId: circle.circleId, memberId: circle.members[member] }, description: "Top-up", returnUrl: "https://kin.test" },
    `create-${randomUUID()}`,
  );
  pool.approve(orderId);
  const order = await pool.captureOrder(orderId, `capture-${orderId}`);
  const captureId = order.captures[0]?.id;
  if (captureId === undefined) throw new Error("No capture");
  return { circle, pool, deps: { db: db.service, pool }, orderId, captureId };
}

const ledgerOf = (circleId: string) => asService(db.service, circleId, (tx) => readLedger(tx, { id: circleId, currency: "USD" }));
const topUps = async (circleId: string): Promise<LedgerEntry[]> => (await ledgerOf(circleId)).entries.filter((entry) => entry.source.type === "paypal_event" && !entry.simulated);
const eventStates = (circleId: string) => paypalEventStates(db, circleId);

describe("the worker's PayPal inbox", () => {
  it("credits the member with the gross amount once the captured order is read back from PayPal", async () => {
    const { circle, deps, orderId, captureId } = await paid(2500);
    const before = await ledgerOf(circle.circleId);

    const outcome = await handleInboxMessage(deps, { kind: "order_captured", circleId: circle.circleId, orderId });

    expect(outcome).toEqual({ result: "applied", circleId: circle.circleId, captures: ["recorded"] });
    const [entry] = await topUps(circle.circleId);
    expect(entry).toMatchObject({ kind: "contribution", source: { type: "paypal_event", id: captureId }, simulated: false, currency: "USD" });
    const after = await ledgerOf(circle.circleId);
    const marcus = memberAccount(circle.members.marcus);
    expect(accountBalance(after, marcus) - accountBalance(before, marcus)).toBe(2500);
    expect(accountBalance(after, "pool_cash") - accountBalance(before, "pool_cash")).toBe(2500 - 52);
    expect(accountBalance(after, "fees") - accountBalance(before, "fees")).toBe(52);
  });

  it("writes one entry when the webhook and the direct read both report the same capture, in either order", async () => {
    const first = await paid();
    await handleInboxMessage(first.deps, { kind: "order_captured", circleId: first.circle.circleId, orderId: first.orderId });
    const late = await handleInboxMessage(first.deps, { kind: "webhook", delivery: first.pool.completedEvent(first.captureId) });
    expect(late).toEqual({ result: "applied", circleId: first.circle.circleId, captures: ["already_recorded"] });
    expect(await topUps(first.circle.circleId)).toHaveLength(1);

    const second = await paid();
    await handleInboxMessage(second.deps, { kind: "webhook", delivery: second.pool.completedEvent(second.captureId) });
    const again = await handleInboxMessage(second.deps, { kind: "order_captured", circleId: second.circle.circleId, orderId: second.orderId });
    expect(again).toEqual({ result: "applied", circleId: second.circle.circleId, captures: ["already_recorded"] });
    expect(await topUps(second.circle.circleId)).toHaveLength(1);
    expect(await eventStates(second.circle.circleId)).toEqual([{ eventId: `WH-${second.captureId}`, state: "processed" }]);
  });

  it("ignores a redelivered event that was already handled", async () => {
    const { circle, pool, deps, captureId } = await paid();
    const delivery = pool.completedEvent(captureId);
    await handleInboxMessage(deps, { kind: "webhook", delivery });
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery })).toEqual({ result: "duplicate" });
    expect(await topUps(circle.circleId)).toHaveLength(1);
  });

  it("files a genuine event once, even when it is replayed naming another circle", async () => {
    const { circle, pool, deps, captureId } = await paid();
    const genuine = pool.completedEvent(captureId);
    await handleInboxMessage(deps, { kind: "webhook", delivery: genuine });
    const target = await visitorWithCircle(db);
    const replayed = genuine.body.replace(/kin1:[0-9a-f-]{36}:/, `kin1:${target.circleId}:`);
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: { ...genuine, body: replayed } })).toEqual({ result: "duplicate" });
    expect(await eventStates(target.circleId)).toEqual([]);
    expect(await topUps(target.circleId)).toEqual([]);
    expect(await topUps(circle.circleId)).toHaveLength(1);
  });

  it("keeps an event PayPal does not vouch for, marked rejected, and writes nothing", async () => {
    const { circle, pool, deps, captureId } = await paid();
    pool.signaturesValid = false;
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: pool.completedEvent(captureId) })).toEqual({ result: "rejected" });
    expect(await topUps(circle.circleId)).toEqual([]);
    expect(await eventStates(circle.circleId)).toEqual([{ eventId: `WH-${captureId}`, state: "rejected" }]);
  });

  it("trusts the capture read back from PayPal, not the circle the event's body claims", async () => {
    const { pool, deps, captureId } = await paid();
    const target = await visitorWithCircle(db);
    const genuine = pool.completedEvent(captureId);
    const body = genuine.body.replace(/kin1:[0-9a-f-]{36}:/, `kin1:${target.circleId}:`);

    const outcome = await handleInboxMessage(deps, { kind: "webhook", delivery: { ...genuine, body } });

    expect(outcome).toEqual({ result: "failed", circleId: target.circleId, reason: "other_circle" });
    expect(await topUps(target.circleId)).toEqual([]);
    expect(await eventStates(target.circleId)).toEqual([{ eventId: `WH-${captureId}`, state: "failed" }]);
  });

  it("refuses a captured order that belongs to another circle", async () => {
    const { deps, orderId } = await paid();
    const other = await visitorWithCircle(db);
    expect(await handleInboxMessage(deps, { kind: "order_captured", circleId: other.circleId, orderId })).toEqual({ result: "failed", circleId: other.circleId, reason: "other_circle" });
    expect(await topUps(other.circleId)).toEqual([]);
  });

  it("files nothing for an event that names no circle Kin has, or none at all", async () => {
    const { pool, deps, captureId } = await paid();
    const genuine = pool.completedEvent(captureId);
    const nowhere = genuine.body.replace(/kin1:[0-9a-f-]{36}:/, `kin1:${randomUUID()}:`);
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: { ...genuine, body: nowhere } })).toEqual({ result: "unplaced" });
    const unnamed = genuine.body.replace(/"custom_id":"[^"]+",/, "");
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: { ...genuine, body: unnamed } })).toEqual({ result: "unplaced" });
    expect(await handleInboxMessage(deps, { kind: "webhook", delivery: { ...genuine, body: "not json" } })).toEqual({ result: "unreadable" });
  });

  it("throws when PayPal cannot be reached, so the message is tried again, and applies it on the retry", async () => {
    const { circle, pool, deps, captureId } = await paid();
    const delivery = pool.completedEvent(captureId);
    pool.failNext = "getCapture";
    await expect(handleInboxMessage(deps, { kind: "webhook", delivery })).rejects.toMatchObject({ outcome: "unavailable", retryable: true });
    expect(await eventStates(circle.circleId)).toEqual([{ eventId: `WH-${captureId}`, state: "verified" }]);
    expect(await topUps(circle.circleId)).toEqual([]);

    expect(await handleInboxMessage(deps, { kind: "webhook", delivery })).toEqual({ result: "applied", circleId: circle.circleId, captures: ["recorded"] });
    expect(await topUps(circle.circleId)).toHaveLength(1);
  });

  it("keeps a verified event it cannot apply as failed, for a person to look at", async () => {
    const circle = await visitorWithCircle(db);
    const pool = fakePool();
    const stranger = randomUUID();
    const { orderId } = await pool.createOrder(
      { amount: { cents: 1000, currency: "USD" }, reference: { circleId: circle.circleId, memberId: stranger }, description: "Top-up", returnUrl: "https://kin.test" },
      "create-stranger",
    );
    pool.approve(orderId);
    const captureId = (await pool.captureOrder(orderId, "capture-stranger")).captures[0]?.id ?? "";
    const outcome = await handleInboxMessage({ db: db.service, pool }, { kind: "webhook", delivery: pool.completedEvent(captureId) });
    expect(outcome).toMatchObject({ result: "failed", circleId: circle.circleId });
    expect(await eventStates(circle.circleId)).toEqual([{ eventId: `WH-${captureId}`, state: "failed" }]);
    expect(await topUps(circle.circleId)).toEqual([]);
  });

  it("records nothing for an order PayPal has not captured", async () => {
    const circle = await visitorWithCircle(db);
    const pool = fakePool();
    const { orderId } = await pool.createOrder(
      { amount: { cents: 1000, currency: "USD" }, reference: { circleId: circle.circleId, memberId: circle.members.marcus }, description: "Top-up", returnUrl: "https://kin.test" },
      "create-uncaptured",
    );
    expect(await handleInboxMessage({ db: db.service, pool }, { kind: "order_captured", circleId: circle.circleId, orderId })).toEqual({ result: "applied", circleId: circle.circleId, captures: [] });
    expect(await topUps(circle.circleId)).toEqual([]);
  });
});
