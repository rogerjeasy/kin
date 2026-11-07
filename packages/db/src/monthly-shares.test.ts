import { accountBalance, memberAccount } from "@kin/domain";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { readLedger } from "./ledger-store.ts";
import { MonthlyShareError, followPayPal, moveMonthlyShare, readShare, recordShareCharge, recordSimulatedMonth, startMonthlyShare } from "./monthly-shares.ts";
import { asPerson, asService } from "./scope.ts";
import { readCircle } from "./read-circle.ts";
import { seatPerson, snapshotFor, testDatabases, visitorWithCircle, type VisitorCircle } from "./testing/index.ts";

const db = testDatabases();

/** A demo circle with Marcus (a contributor) seated by a person of their own. */
async function circleWithMarcus(): Promise<{ circle: VisitorCircle; marcus: string }> {
  const circle = await visitorWithCircle(db);
  return { circle, marcus: await seatPerson(db, circle.circleId, circle.members.marcus) };
}

const begin = (userId: string, circleId: string, cents = 15000, id = randomUUID()) =>
  asPerson(db.app, userId, (tx) => startMonthlyShare(tx, { circleId, id, cents, paypalSubscriptionId: null, approvalUrl: null }));
const move = (userId: string, circleId: string, shareId: string, state: "active" | "paused" | "cancelled") =>
  asPerson(db.app, userId, (tx) => moveMonthlyShare(tx, { circleId, shareId, state }));
const ledgerOf = (circleId: string) => asService(db.service, circleId, (tx) => readLedger(tx, { id: circleId, currency: "USD" }));
const refusedWith = (promise: Promise<unknown>, reason: string) => expect(promise).rejects.toMatchObject({ name: "MonthlyShareError", reason });

describe("a member's monthly share", () => {
  it("starts running at once in a demo circle, as a simulated share every member of the circle can read", async () => {
    const { circle, marcus } = await circleWithMarcus();
    const id = await begin(marcus, circle.circleId, 15000);

    const seen = await snapshotFor(db, circle.userId, circle.circleId);
    expect(seen.monthlyShares).toEqual([expect.objectContaining({ id, memberId: circle.members.marcus, cents: 15000, state: "active", simulated: true, paypalSubscriptionId: null, approvalUrl: null })]);
  });

  it("is hidden from a caregiver, who sees none of the family's money", async () => {
    const { circle, marcus } = await circleWithMarcus();
    await begin(marcus, circle.circleId);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    expect((await snapshotFor(db, amara, circle.circleId)).monthlyShares).toEqual([]);
  });

  it("is refused to an observer, a parent and a caregiver, and to anyone with no seat", async () => {
    const circle = await visitorWithCircle(db);
    for (const key of ["daniel", "rose", "amara"] as const) {
      const userId = await seatPerson(db, circle.circleId, circle.members[key]);
      await refusedWith(begin(userId, circle.circleId), "refused");
    }
    const stranger = (await visitorWithCircle(db)).userId;
    await refusedWith(begin(stranger, circle.circleId), "refused");
  });

  it("is held to a top-up's limits", async () => {
    const { circle, marcus } = await circleWithMarcus();
    await refusedWith(begin(marcus, circle.circleId, 99), "invalid");
    await refusedWith(begin(marcus, circle.circleId, 500_001), "invalid");
  });

  it("refuses a PayPal subscription in a demo circle", async () => {
    const { circle, marcus } = await circleWithMarcus();
    await refusedWith(
      asPerson(db.app, marcus, (tx) => startMonthlyShare(tx, { circleId: circle.circleId, id: randomUUID(), cents: 5000, paypalSubscriptionId: "I-ABCDEF123456", approvalUrl: "https://www.sandbox.paypal.com/x" })),
      "refused",
    );
  });

  it("is one at a time: a running share must be ended first, and an unapproved one is replaced", async () => {
    const { circle, marcus } = await circleWithMarcus();
    const first = await begin(marcus, circle.circleId);
    await refusedWith(begin(marcus, circle.circleId), "running");
    await move(marcus, circle.circleId, first, "cancelled");
    const second = await begin(marcus, circle.circleId, 20000);
    const seen = await snapshotFor(db, marcus, circle.circleId);
    expect(seen.monthlyShares.map((share) => [share.id, share.state])).toEqual([[first, "cancelled"], [second, "active"]]);
  });

  it("pauses, resumes and ends only along the diagram, and a cancelled share stays cancelled", async () => {
    const { circle, marcus } = await circleWithMarcus();
    const id = await begin(marcus, circle.circleId);
    await move(marcus, circle.circleId, id, "paused");
    await move(marcus, circle.circleId, id, "active");
    await move(marcus, circle.circleId, id, "cancelled");
    await refusedWith(move(marcus, circle.circleId, id, "active"), "move");
    await expect(asService(db.service, circle.circleId, (tx) => tx.execute(sql`update monthly_shares set state = 'active' where id = ${id}`))).rejects.toThrow();
  });

  it("can be moved only by its own member", async () => {
    const { circle, marcus } = await circleWithMarcus();
    const id = await begin(marcus, circle.circleId);
    // Elena organizes the circle but cannot pause or end Marcus's share.
    await refusedWith(move(circle.userId, circle.circleId, id, "cancelled"), "refused");
    const ana = await seatPerson(db, circle.circleId, circle.members.ana);
    await refusedWith(move(ana, circle.circleId, id, "paused"), "refused");
  });

  it("is audited when it starts and when it changes", async () => {
    const { circle, marcus } = await circleWithMarcus();
    const id = await begin(marcus, circle.circleId);
    await move(marcus, circle.circleId, id, "paused");
    const rows = await asService(db.service, circle.circleId, (tx) => tx.execute<{ action: string }>(sql`select action from audit_log where subject_id = ${id} order by sequence`));
    expect(rows.rows.map((row) => row.action)).toEqual(["monthly_share.started", "monthly_share.paused"]);
  });

  it("is not writable by a person except through its operations", async () => {
    const { circle, marcus } = await circleWithMarcus();
    await expect(asPerson(db.app, marcus, (tx) => tx.execute(sql`insert into monthly_shares (id, circle_id, member_id, amount_cents, currency, simulated) values (${randomUUID()}, ${circle.circleId}, ${circle.members.marcus}, 100, 'USD', true)`))).rejects.toThrow();
  });
});

describe("what a share records in the ledger", () => {
  it("credits a demo share's month once, labelled simulated, with no fee", async () => {
    const { circle, marcus } = await circleWithMarcus();
    const id = await begin(marcus, circle.circleId, 15000);
    const share = await asService(db.service, circle.circleId, (tx) => readShare(tx, circle.circleId, { id }));
    if (share === null) throw new Error("No share");
    const before = await ledgerOf(circle.circleId);

    const first = await asService(db.service, circle.circleId, (tx) => recordSimulatedMonth(tx, circle.circleId, share));
    const again = await asService(db.service, circle.circleId, (tx) => recordSimulatedMonth(tx, circle.circleId, share));

    expect([first, again]).toEqual(["recorded", "already_recorded"]);
    const after = await ledgerOf(circle.circleId);
    expect(after.entries.filter((entry) => entry.source.id.startsWith(`simulated-share-${id}`))).toEqual([expect.objectContaining({ kind: "contribution", simulated: true })]);
    expect(accountBalance(after, memberAccount(circle.members.marcus)) - accountBalance(before, memberAccount(circle.members.marcus))).toBe(15000);
    expect(accountBalance(after, "fees") - accountBalance(before, "fees")).toBe(0);
  });

  it("credits a real charge the gross once, by its PayPal transaction, with PayPal's fee shared", async () => {
    const { circle, marcus } = await circleWithMarcus();
    const id = await begin(marcus, circle.circleId, 15000);
    const share = await asService(db.service, circle.circleId, (tx) => readShare(tx, circle.circleId, { id }));
    if (share === null) throw new Error("No share");
    const before = await ledgerOf(circle.circleId);
    const charge = { id: "SALE4N9X2KQ7", gross: { cents: 15000, currency: "USD" }, fee: { cents: 465, currency: "USD" }, paidAt: new Date("2026-10-20T15:00:00Z") };

    const outcomes = [await asService(db.service, circle.circleId, (tx) => recordShareCharge(tx, circle.circleId, share, charge)), await asService(db.service, circle.circleId, (tx) => recordShareCharge(tx, circle.circleId, share, charge))];

    expect(outcomes).toEqual(["recorded", "already_recorded"]);
    const after = await ledgerOf(circle.circleId);
    expect(after.entries.find((entry) => entry.source.id === charge.id)).toMatchObject({ kind: "contribution", simulated: false, description: "Monthly share through PayPal" });
    expect(accountBalance(after, memberAccount(circle.members.marcus)) - accountBalance(before, memberAccount(circle.members.marcus))).toBe(15000);
    expect(accountBalance(after, "pool_cash") - accountBalance(before, "pool_cash")).toBe(15000 - 465);
  });

  it("follows PayPal's word on the state and failed charges, but never moves a share backwards", async () => {
    const { circle, marcus } = await circleWithMarcus();
    const id = await begin(marcus, circle.circleId);
    await move(marcus, circle.circleId, id, "cancelled");
    const share = await asService(db.service, circle.circleId, (tx) => readShare(tx, circle.circleId, { id }));
    if (share === null) throw new Error("No share");

    await asService(db.service, circle.circleId, (tx) => followPayPal(tx, circle.circleId, share, { state: "active", failedPayments: 2, nextBillingAt: null }));

    const seen = (await snapshotFor(db, marcus, circle.circleId)).monthlyShares.find((each) => each.id === id);
    expect(seen).toMatchObject({ state: "cancelled", failedPayments: 2 });
  });

  it("never writes a simulated month into a share that is not simulated", async () => {
    const { circle, marcus } = await circleWithMarcus();
    const id = await begin(marcus, circle.circleId);
    const share = await asService(db.service, circle.circleId, (tx) => readShare(tx, circle.circleId, { id }));
    if (share === null) throw new Error("No share");
    await expect(asService(db.service, circle.circleId, (tx) => recordSimulatedMonth(tx, circle.circleId, { ...share, simulated: false }))).rejects.toThrow(MonthlyShareError);
  });
});

describe("one family's shares are not another's", () => {
  it("cannot be read, started or moved from another circle", async () => {
    const [one, other] = await Promise.all([circleWithMarcus(), circleWithMarcus()]);
    const id = await begin(one.marcus, one.circle.circleId);
    await expect(asPerson(db.app, other.marcus, (tx) => readCircle(tx, { circleId: one.circle.circleId, userId: other.marcus, now: new Date() }))).rejects.toThrow();
    await refusedWith(move(other.marcus, one.circle.circleId, id, "cancelled"), "refused");
    await refusedWith(begin(other.marcus, one.circle.circleId), "refused");
  });
});
