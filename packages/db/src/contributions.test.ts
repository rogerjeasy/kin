import { accountBalance, memberAccount } from "@kin/domain";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { ContributionMismatchError, contributionRecorded, recordContribution, type ConfirmedCapture } from "./contributions.ts";
import { readLedger } from "./ledger-store.ts";
import { settlePayPalEvent, storePayPalEvent } from "./paypal-events.ts";
import { asPerson, asService } from "./scope.ts";
import { paypalEventStates, testDatabases, visitorWithCircle, type VisitorCircle } from "./testing/index.ts";
import { countIn } from "./testing/sql.ts";

const db = testDatabases();

const capture = (circle: VisitorCircle, overrides: Partial<ConfirmedCapture> = {}): ConfirmedCapture => ({
  captureId: `CAP${randomUUID().replaceAll("-", "").slice(0, 14).toUpperCase()}`,
  memberId: circle.members.marcus,
  gross: { cents: 2500, currency: "USD" },
  fee: { cents: 136, currency: "USD" },
  capturedAt: new Date("2026-11-01T03:30:00Z"),
  ...overrides,
});
const record = (circle: VisitorCircle, paid: ConfirmedCapture) => asService(db.service, circle.circleId, (tx) => recordContribution(tx, circle.circleId, paid));
const ledgerOf = (circleId: string) => asService(db.service, circleId, (tx) => readLedger(tx, { id: circleId, currency: "USD" }));

describe("recording a top-up PayPal confirmed", () => {
  it("credits the member the gross, puts the net in the pool and shares the fee, dated in the circle's timezone", async () => {
    const circle = await visitorWithCircle(db);
    const before = await ledgerOf(circle.circleId);
    const paid = capture(circle);

    expect(await record(circle, paid)).toBe("recorded");

    const after = await ledgerOf(circle.circleId);
    const entry = after.entries.find((each) => each.source.id === paid.captureId);
    // Rose's circle keeps New York time: 03:30 UTC on 1 November is still 31 October there.
    expect(entry).toMatchObject({ kind: "contribution", occurredOn: "2026-10-31", period: "2026-10", simulated: false, source: { type: "paypal_event" } });
    const marcus = memberAccount(circle.members.marcus);
    expect(accountBalance(after, marcus) - accountBalance(before, marcus)).toBe(2500);
    expect(accountBalance(after, "pool_cash") - accountBalance(before, "pool_cash")).toBe(2364);
    expect(accountBalance(after, "fees") - accountBalance(before, "fees")).toBe(136);
  });

  it("writes one entry for one capture, however many times it is reported", async () => {
    const circle = await visitorWithCircle(db);
    const paid = capture(circle);
    expect(await record(circle, paid)).toBe("recorded");
    expect(await record(circle, paid)).toBe("already_recorded");
    expect(await Promise.all([record(circle, capture(circle, { captureId: paid.captureId })), record(circle, paid)])).toEqual(["already_recorded", "already_recorded"]);
    expect((await ledgerOf(circle.circleId)).entries.filter((entry) => entry.source.id === paid.captureId)).toHaveLength(1);
  });

  it("refuses a capture for a member who is not in the circle, or in another currency", async () => {
    const circle = await visitorWithCircle(db);
    const other = await visitorWithCircle(db);
    await expect(record(circle, capture(circle, { memberId: other.members.marcus }))).rejects.toThrow(ContributionMismatchError);
    await expect(record(circle, capture(circle, { gross: { cents: 2500, currency: "EUR" }, fee: { cents: 0, currency: "EUR" } }))).rejects.toThrow(ContributionMismatchError);
  });

  it("cannot be written to one circle while acting for another", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    await expect(asService(db.service, mine.circleId, (tx) => recordContribution(tx, theirs.circleId, capture(theirs)))).rejects.toThrow(ContributionMismatchError);
  });

  it("lets a member see whether their top-up is recorded, and nobody outside the circle", async () => {
    const circle = await visitorWithCircle(db);
    const paid = capture(circle);
    const seen = (userId: string, circleId: string) => asPerson(db.app, userId, (tx) => contributionRecorded(tx, circleId, paid.captureId));
    expect(await seen(circle.userId, circle.circleId)).toBe(false);
    await record(circle, paid);
    expect(await seen(circle.userId, circle.circleId)).toBe(true);
    const stranger = await visitorWithCircle(db);
    expect(await seen(stranger.userId, circle.circleId)).toBe(false);
  });
});

describe("PayPal's events as stored", () => {
  const event = (circleId: string, eventId = `WH-${randomUUID()}`) => ({ circleId, eventId, eventType: "PAYMENT.CAPTURE.COMPLETED", rawBody: `{"id":"${eventId}"}`, headers: { "paypal-transmission-id": "T-1" } });

  it("keep the first copy of a redelivered event and move it forward", async () => {
    const circle = await visitorWithCircle(db);
    const delivery = event(circle.circleId);
    const first = await asService(db.service, circle.circleId, (tx) => storePayPalEvent(tx, delivery));
    expect(first?.state).toBe("received");
    await asService(db.service, circle.circleId, (tx) => settlePayPalEvent(tx, first?.id ?? "", "processed"));
    const again = await asService(db.service, circle.circleId, (tx) => storePayPalEvent(tx, delivery));
    expect(again).toEqual({ id: first?.id, state: "processed" });
    expect(await paypalEventStates(db, circle.circleId)).toEqual([{ eventId: delivery.eventId, state: "processed" }]);
  });

  it("are filed once: an event ID another circle holds is not filed again", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    const eventId = `WH-${randomUUID()}`;
    await asService(db.service, mine.circleId, (tx) => storePayPalEvent(tx, event(mine.circleId, eventId)));
    expect(await asService(db.service, theirs.circleId, (tx) => storePayPalEvent(tx, event(theirs.circleId, eventId)))).toBeNull();
    expect(await paypalEventStates(db, theirs.circleId)).toEqual([]);
  });

  it("are invisible to every person, and to the service acting for another circle", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    await asService(db.service, mine.circleId, (tx) => storePayPalEvent(tx, event(mine.circleId)));
    expect(await asPerson(db.app, mine.userId, (tx) => countIn(tx, "paypal_events", mine.circleId))).toBe(0);
    expect(await asService(db.service, theirs.circleId, (tx) => countIn(tx, "paypal_events", mine.circleId))).toBe(0);
    expect(await asService(db.service, mine.circleId, (tx) => countIn(tx, "paypal_events", mine.circleId))).toBe(1);
  });
});

describe("money that arrives wakes the payments waiting for it", () => {
  /** A payout or refill message the worker held for want of money, due a quarter of an hour from now. */
  const held = async (circleId: string, topic: string): Promise<string> => {
    const id = randomUUID();
    await db.admin.execute(sql`insert into outbox (id, circle_id, topic, payload, available_at) values (${id}, ${circleId}, ${topic}, '{}'::jsonb, now() + interval '15 minutes')`);
    return id;
  };
  const due = async (id: string): Promise<boolean> =>
    (await db.admin.execute<{ due: boolean }>(sql`select available_at <= now() as due from outbox where id = ${id}`)).rows[0]?.due === true;

  it("makes the circle's waiting payouts and refills due at once when a top-up is recorded, and nothing else", async () => {
    const circle = await visitorWithCircle(db);
    const other = await visitorWithCircle(db);
    const payout = await held(circle.circleId, "payout.execute");
    const refill = await held(circle.circleId, "purchase.execute");
    const unrelated = await held(circle.circleId, "shift.settle");
    const elsewhere = await held(other.circleId, "payout.execute");
    await record(circle, capture(circle));
    expect([await due(payout), await due(refill), await due(unrelated), await due(elsewhere)]).toEqual([true, true, false, false]);
  });

  it("wakes nothing when the same capture is read a second time", async () => {
    const circle = await visitorWithCircle(db);
    const paid = capture(circle);
    await record(circle, paid);
    const payout = await held(circle.circleId, "payout.execute");
    expect(await record(circle, paid)).toBe("already_recorded");
    expect(await due(payout)).toBe(false);
  });

  it("lets a member wake their own circle and nobody another's", async () => {
    const circle = await visitorWithCircle(db);
    const other = await visitorWithCircle(db);
    const wake = (userId: string, circleId: string) => asPerson(db.app, userId, (tx) => tx.execute(sql`select kin_private.wake_waiting_money(${circleId}::uuid)`));
    await expect(wake(circle.userId, circle.circleId)).resolves.toBeDefined();
    await expect(wake(other.userId, circle.circleId)).rejects.toThrow();
    await expect(asService(db.service, other.circleId, (tx) => tx.execute(sql`select kin_private.wake_waiting_money(${circle.circleId}::uuid)`))).rejects.toThrow();
  });
});
