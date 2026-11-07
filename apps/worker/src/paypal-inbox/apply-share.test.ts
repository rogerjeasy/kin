import { asService, readLedger } from "@kin/db";
import { insertShare, paypalEventStates, seatPerson, snapshotFor, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { accountBalance, memberAccount, type LedgerEntry } from "@kin/domain";
import { fakePool, type FakePool } from "@kin/paypal/testing";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { handleInboxMessage, type InboxDeps } from "./handle-message.ts";

const db = testDatabases();

const ledgerOf = (circleId: string) => asService(db.service, circleId, (tx) => readLedger(tx, { id: circleId, currency: "USD" }));
const entriesOf = async (circleId: string, prefix: string): Promise<LedgerEntry[]> => (await ledgerOf(circleId)).entries.filter((entry) => entry.source.id.startsWith(prefix));
const check = (circleId: string, shareId: string) => ({ kind: "subscription_checked", circleId, subscriptionId: shareId, requestId: randomUUID() }) as const;

type Real = { circle: VisitorCircle; pool: FakePool; deps: InboxDeps; shareId: string; subscriptionId: string };

/** Marcus has a real monthly share of $150 that PayPal made and he approved. The row is written as the service, because a demo circle takes only simulated shares from a person. */
async function realShare(options: { approve?: boolean; memberOf?: "marcus" | "ana" } = {}): Promise<Real> {
  const circle = await visitorWithCircle(db);
  const pool = fakePool({ now: () => new Date() });
  const shareId = randomUUID();
  const reference = { circleId: circle.circleId, memberId: circle.members.marcus };
  const { subscriptionId } = await pool.createSubscription({ amount: { cents: 15000, currency: "USD" }, reference, description: "Share", returnUrl: "https://kin.test" }, shareId);
  if (options.approve ?? true) pool.approveSubscription(subscriptionId);
  const owner = circle.members[options.memberOf ?? "marcus"];
  await insertShare(db, circle.circleId, { id: shareId, memberId: owner, cents: 15000, paypalSubscriptionId: subscriptionId });
  return { circle, pool, deps: { db: db.service, pool }, shareId, subscriptionId };
}

describe("the worker and a monthly share", () => {
  it("records a demo share's month as simulated, once", async () => {
    const circle = await visitorWithCircle(db);
    const marcus = await seatPerson(db, circle.circleId, circle.members.marcus);
    const shareId = randomUUID();
    await insertShare(db, circle.circleId, { id: shareId, memberId: circle.members.marcus, cents: 15000 });
    const deps: InboxDeps = { db: db.service, pool: fakePool() };
    const before = await ledgerOf(circle.circleId);

    expect(await handleInboxMessage(deps, check(circle.circleId, shareId))).toEqual({ result: "share_synced", circleId: circle.circleId, charges: ["recorded"] });
    expect(await handleInboxMessage(deps, check(circle.circleId, shareId))).toEqual({ result: "share_synced", circleId: circle.circleId, charges: ["already_recorded"] });

    expect(await entriesOf(circle.circleId, `simulated-share-${shareId}`)).toEqual([expect.objectContaining({ simulated: true, kind: "contribution" })]);
    const after = await ledgerOf(circle.circleId);
    expect(accountBalance(after, memberAccount(circle.members.marcus)) - accountBalance(before, memberAccount(circle.members.marcus))).toBe(15000);
    expect((await snapshotFor(db, marcus, circle.circleId)).monthlyShares[0]).toMatchObject({ state: "active", simulated: true });
  });

  it("records nothing for a paused demo share", async () => {
    const circle = await visitorWithCircle(db);
    const shareId = randomUUID();
    await insertShare(db, circle.circleId, { id: shareId, memberId: circle.members.marcus, cents: 15000, state: "paused" });
    expect(await handleInboxMessage({ db: db.service, pool: fakePool() }, check(circle.circleId, shareId))).toEqual({ result: "share_synced", circleId: circle.circleId, charges: [] });
    expect(await entriesOf(circle.circleId, "simulated-share")).toEqual([]);
  });

  it("reads a real share back from PayPal: it turns active and its first charge is credited the gross, with PayPal's fee", async () => {
    const { circle, deps, shareId, subscriptionId, pool } = await realShare();
    const before = await ledgerOf(circle.circleId);
    const [charge] = [...(pool.subscriptions.get(subscriptionId)?.payments ?? [])];
    if (charge === undefined) throw new Error("No charge");

    expect(await handleInboxMessage(deps, check(circle.circleId, shareId))).toEqual({ result: "share_synced", circleId: circle.circleId, charges: ["recorded"] });

    const after = await ledgerOf(circle.circleId);
    expect(after.entries.find((entry) => entry.source.id === charge.id)).toMatchObject({ simulated: false, kind: "contribution", description: "Monthly share through PayPal" });
    expect(accountBalance(after, memberAccount(circle.members.marcus)) - accountBalance(before, memberAccount(circle.members.marcus))).toBe(15000);
    expect(accountBalance(after, "fees") - accountBalance(before, "fees")).toBe(52);
    const owner = await seatPerson(db, circle.circleId, circle.members.ana);
    expect((await snapshotFor(db, owner, circle.circleId)).monthlyShares[0]).toMatchObject({ id: shareId, state: "active", simulated: false });
  });

  it("writes one entry per charge when the webhook and the read both report it, in either order", async () => {
    const { circle, deps, shareId, subscriptionId, pool } = await realShare();
    await handleInboxMessage(deps, check(circle.circleId, shareId));
    const next = pool.chargeSubscription(subscriptionId);

    const viaWebhook = await handleInboxMessage(deps, { kind: "webhook", delivery: pool.saleEvent(subscriptionId, next.id) });
    expect(viaWebhook).toEqual({ result: "share_synced", circleId: circle.circleId, charges: ["already_recorded", "recorded"] });
    expect(await handleInboxMessage(deps, check(circle.circleId, shareId))).toEqual({ result: "share_synced", circleId: circle.circleId, charges: ["already_recorded", "already_recorded"] });

    expect((await ledgerOf(circle.circleId)).entries.filter((entry) => entry.description === "Monthly share through PayPal")).toHaveLength(2);
    expect((await paypalEventStates(db, circle.circleId)).map((event) => event.state)).toEqual(["processed"]);
  });

  it("follows PayPal when the member pauses, resumes or cancels there, and counts failed charges", async () => {
    const { circle, deps, shareId, subscriptionId, pool } = await realShare();
    await handleInboxMessage(deps, check(circle.circleId, shareId));
    const view = async () => (await snapshotFor(db, circle.userId, circle.circleId)).monthlyShares.find((share) => share.id === shareId);

    await pool.changeSubscription(subscriptionId, "suspend", "r", "req-1");
    await handleInboxMessage(deps, { kind: "webhook", delivery: pool.subscriptionEvent(subscriptionId, "BILLING.SUBSCRIPTION.SUSPENDED") });
    expect(await view()).toMatchObject({ state: "paused" });

    await pool.changeSubscription(subscriptionId, "activate", "r", "req-2");
    pool.failSubscriptionCharge(subscriptionId);
    await handleInboxMessage(deps, { kind: "webhook", delivery: pool.subscriptionEvent(subscriptionId, "BILLING.SUBSCRIPTION.PAYMENT.FAILED") });
    expect(await view()).toMatchObject({ state: "active", failedPayments: 1 });

    await pool.changeSubscription(subscriptionId, "cancel", "r", "req-3");
    await handleInboxMessage(deps, check(circle.circleId, shareId));
    expect(await view()).toMatchObject({ state: "cancelled" });
  });

  it("stores and applies nothing from a delivery PayPal does not vouch for", async () => {
    const { circle, deps, shareId, subscriptionId, pool } = await realShare();
    await handleInboxMessage(deps, check(circle.circleId, shareId));
    const next = pool.chargeSubscription(subscriptionId);
    pool.signaturesValid = false;

    const outcome = await handleInboxMessage(deps, { kind: "webhook", delivery: pool.saleEvent(subscriptionId, next.id) });

    expect(outcome).toMatchObject({ result: "rejected" });
    expect(await paypalEventStates(db, circle.circleId)).toEqual([]);
    expect((await ledgerOf(circle.circleId)).entries.filter((entry) => entry.description === "Monthly share through PayPal")).toHaveLength(1);
  });

  it("refuses a subscription that PayPal says belongs to another member", async () => {
    const { circle, deps, shareId } = await realShare({ memberOf: "ana" });
    expect(await handleInboxMessage(deps, check(circle.circleId, shareId))).toEqual({ result: "failed", circleId: circle.circleId, reason: "other_circle" });
    expect((await ledgerOf(circle.circleId)).entries.filter((entry) => entry.description === "Monthly share through PayPal")).toEqual([]);
  });

  it("says so when the share is not in the circle the message names", async () => {
    const [one, other] = await Promise.all([visitorWithCircle(db), realShare()]);
    expect(await handleInboxMessage({ db: db.service, pool: other.pool }, check(one.circleId, other.shareId))).toEqual({ result: "failed", circleId: one.circleId, reason: "unknown_share" });
  });

  it("asks again when PayPal cannot be reached, and writes nothing meanwhile", async () => {
    const { circle, deps, shareId, pool } = await realShare();
    pool.failNext = "getSubscription";
    await expect(handleInboxMessage(deps, check(circle.circleId, shareId))).rejects.toThrow();
    expect((await ledgerOf(circle.circleId)).entries.filter((entry) => entry.description === "Monthly share through PayPal")).toEqual([]);
  });
});
