import { asPerson, createCircle, readCircle, takeDemoSeat, type CircleSnapshot } from "@kin/db";
import { signedIn, snapshotFor, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import type { Inbox, InboxMessage } from "@kin/paypal";
import { fakePool, type FakePool } from "@kin/paypal/testing";
import { describe, expect, it } from "vitest";

import { runMonthlyShare, type ShareContext } from "./monthly-shares";

const db = testDatabases();

function fakeInbox(): Inbox & { sent: InboxMessage[] } {
  const sent: InboxMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
    receive: async () => [],
    remove: async () => undefined,
  };
}

type Setup = { context: ShareContext; pool: FakePool; inbox: ReturnType<typeof fakeInbox>; reload: () => Promise<CircleSnapshot> };

function setup(userId: string, circle: CircleSnapshot, circleId: string, options: { services?: boolean } = {}): Setup {
  const pool = fakePool();
  const inbox = fakeInbox();
  const context: ShareContext = {
    db: db.app,
    userId,
    circle,
    services: options.services === false ? null : { pool, inbox },
    returnUrl: "https://kin.test/dashboard/circle?monthly=back",
    description: "Monthly share to Rose’s circle on Kin",
  };
  return { context, pool, inbox, reload: () => snapshotFor(db, userId, circleId) };
}

/** A demo visitor in `persona`'s seat of a fresh demo circle. */
async function demoAs(persona: keyof VisitorCircle["members"]) {
  const visitor = await visitorWithCircle(db);
  await asPerson(db.app, visitor.userId, (tx) => takeDemoSeat(tx, visitor.circleId, visitor.members[persona]));
  return setup(visitor.userId, await snapshotFor(db, visitor.userId, visitor.circleId), visitor.circleId);
}

/** A person who signed in and started a real circle: the organizer of a family that has no demo behind it. */
async function realOrganizer() {
  const userId = await signedIn(db.app, "Elena");
  const circleId = await asPerson(db.app, userId, (tx) => createCircle(tx, { name: "Mum's circle", timezone: "UTC", currency: "USD", parentName: "Meera", parentLevel: "informed", relationship: null }));
  return setup(userId, await snapshotFor(db, userId, circleId), circleId);
}

describe("a monthly share in a demo circle", () => {
  it("starts at once, simulated, with no PayPal subscription, and asks the worker to record its first month", async () => {
    const { context, pool, inbox, reload } = await demoAs("marcus");

    expect(await runMonthlyShare(context, { operation: "start", amount: " 150.00 " })).toEqual({ ok: true, approvalUrl: null });

    expect(pool.subscriptions.size).toBe(0);
    const [share] = (await reload()).monthlyShares;
    expect(share).toMatchObject({ cents: 15000, state: "active", simulated: true });
    expect(inbox.sent).toEqual([expect.objectContaining({ kind: "subscription_checked", subscriptionId: share?.id })]);
  });

  it("is paused, resumed and ended by its own member, and a second start waits until it ends", async () => {
    const { context, reload } = await demoAs("ana");
    await runMonthlyShare(context, { operation: "start", amount: "80" });
    const live = async () => runMonthlyShare({ ...context, circle: await reload() }, { operation: "start", amount: "90" });
    expect(await live()).toEqual({ ok: false, reason: "running" });

    for (const [operation, state] of [["pause", "paused"], ["resume", "active"], ["cancel", "cancelled"]] as const) {
      expect(await runMonthlyShare({ ...context, circle: await reload() }, { operation })).toEqual({ ok: true, approvalUrl: null });
      expect((await reload()).monthlyShares.at(-1)?.state).toBe(state);
    }
    expect(await live()).toEqual({ ok: true, approvalUrl: null });
  });

  it("is refused to the caregiver, the observer and the parent, who do not share the cost", async () => {
    for (const persona of ["amara", "daniel", "rose"] as const) {
      const { context, inbox } = await demoAs(persona);
      expect(await runMonthlyShare(context, { operation: "start", amount: "50.00" })).toEqual({ ok: false, reason: "refused" });
      expect(inbox.sent).toEqual([]);
    }
  });

  it.each([
    [150, "invalid"],
    ["25.005", "amount"],
    ["1e3", "amount"],
    ["0.99", "too_small"],
    ["5000.01", "too_large"],
  ])("refuses an amount of %j", async (amount, reason) => {
    const { context } = await demoAs("marcus");
    expect(await runMonthlyShare(context, { operation: "start", amount })).toEqual({ ok: false, reason });
  });

  it("refuses anything it does not recognise, including extra fields", async () => {
    const { context } = await demoAs("marcus");
    for (const input of [null, "start", [], {}, { operation: "drop" }, { operation: "start", amount: "50", memberId: "someone-else" }, { operation: "pause", amount: "50" }]) {
      expect(await runMonthlyShare(context, input)).toMatchObject({ ok: false });
    }
  });

  it("is off where the deployment has no PayPal app or queue", async () => {
    const visitor = await visitorWithCircle(db);
    const off = setup(visitor.userId, await snapshotFor(db, visitor.userId, visitor.circleId), visitor.circleId, { services: false });
    expect(await runMonthlyShare(off.context, { operation: "start", amount: "50.00" })).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("a monthly share in a real circle", () => {
  it("makes a PayPal subscription and waits for the member to approve it, giving the page only to them", async () => {
    const { context, pool, reload } = await realOrganizer();

    const started = await runMonthlyShare(context, { operation: "start", amount: "150.00" });

    expect(started).toMatchObject({ ok: true });
    const [subscription] = [...pool.subscriptions.values()];
    expect(subscription).toMatchObject({ amount: { cents: 15000, currency: "USD" }, status: "APPROVAL_PENDING", reference: { memberId: context.circle.viewer.memberId } });
    const [share] = (await reload()).monthlyShares;
    expect(share).toMatchObject({ state: "approval_pending", simulated: false, paypalSubscriptionId: subscription?.id });
    expect(share?.approvalUrl).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\//);
    expect(started).toEqual({ ok: true, approvalUrl: share?.approvalUrl });
  });

  it("changes nothing in Kin when PayPal cannot make the subscription", async () => {
    const { context, pool, reload } = await realOrganizer();
    pool.failNext = "createSubscription";
    expect(await runMonthlyShare(context, { operation: "start", amount: "150.00" })).toEqual({ ok: false, reason: "paypal" });
    expect((await reload()).monthlyShares).toEqual([]);
  });

  it("asks PayPal first, and the record moves only once PayPal has agreed", async () => {
    const { context, pool, reload } = await realOrganizer();
    await runMonthlyShare(context, { operation: "start", amount: "150.00" });
    const [subscription] = [...pool.subscriptions.values()];
    if (subscription === undefined) throw new Error("No subscription");
    pool.approveSubscription(subscription.id);

    // PayPal refuses to suspend what it has already ended: Kin's record stays put.
    await pool.changeSubscription(subscription.id, "cancel", "r", "kin-other");
    expect(await runMonthlyShare({ ...context, circle: await reload() }, { operation: "pause" })).toEqual({ ok: false, reason: "paypal" });
    expect((await reload()).monthlyShares[0]?.state).toBe("approval_pending");
  });

  it("cancels the subscription at PayPal and then in the record", async () => {
    const { context, pool, reload } = await realOrganizer();
    await runMonthlyShare(context, { operation: "start", amount: "150.00" });
    const [subscription] = [...pool.subscriptions.values()];
    if (subscription === undefined) throw new Error("No subscription");

    expect(await runMonthlyShare({ ...context, circle: await reload() }, { operation: "cancel" })).toEqual({ ok: true, approvalUrl: null });

    expect(subscription.status).toBe("CANCELLED");
    expect((await reload()).monthlyShares[0]?.state).toBe("cancelled");
  });

  it("never lets one circle's member change another circle's share", async () => {
    const mine = await realOrganizer();
    const theirs = await realOrganizer();
    await runMonthlyShare(theirs.context, { operation: "start", amount: "150.00" });
    // Their circle is not open to this person at all.
    await expect(asPerson(db.app, mine.context.userId, (tx) => readCircle(tx, { circleId: theirs.context.circle.circle.id, userId: mine.context.userId, now: new Date() }))).rejects.toThrow();
    expect(await runMonthlyShare(mine.context, { operation: "cancel" })).toEqual({ ok: false, reason: "refused" });
    expect((await theirs.reload()).monthlyShares[0]?.state).toBe("approval_pending");
  });
});
