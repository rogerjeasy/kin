import { asPerson, attestWishTrigger, readWishes, withdrawWish } from "@kin/db";
import { makeSubscriptionReal, realCircle, serviceRows, testDatabases, type RealCircle } from "@kin/db/testing";
import { fakePool } from "@kin/paypal/testing";
import { describe, expect, it } from "vitest";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

import { runWishSubscriptionBatch } from "./run-subscriptions.ts";

const db = testDatabases();
const CLOCK = new Date("2026-11-10T14:00:00Z");
const lines: Record<string, unknown>[] = [];
const log: InboxLog = (line) => lines.push(line);

/** A real circle whose gym subscription is a real PayPal subscription, active at PayPal. */
async function circleWithRealGym(pool: ReturnType<typeof fakePool>): Promise<{ circle: RealCircle; gymId: string; paypalId: string; amara: string }> {
  const circle = await realCircle(db);
  // Amara may attest a hospital stay, with Elena: both are seated before the circle is made real. Her word counts
  // only if no wish of Rose's keeps her paid, so Rose takes that one back first (it would make Amara stand to gain).
  const amara = circle.amara;
  const keep = (await asPerson(db.app, circle.rose, (tx) => readWishes(tx, circle.circleId))).wishes.find((wish) => wish.rule.kind === "keep_paying");
  await asPerson(db.app, circle.rose, (tx) => withdrawWish(tx, { circleId: circle.circleId, wishId: keep?.id ?? "" }));
  const [gym] = await serviceRows(db, circle.circleId, "select id from parent_subscriptions where name = 'Lakeside Fitness'");
  const gymId = String(gym?.id);
  const paypalId = `I-GYM${circle.circleId.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  await makeSubscriptionReal(db, gymId, paypalId);
  pool.subscriptions.set(paypalId, {
    id: paypalId,
    key: gymId,
    status: "ACTIVE",
    reference: { circleId: circle.circleId, memberId: circle.members.rose },
    amount: { cents: 3900, currency: "USD" },
    payments: [],
    failedPayments: 0,
    requestIds: new Set(),
  });
  return { circle, gymId, paypalId, amara };
}

const attest = (userId: string, circle: RealCircle, stance: "start" | "end") => asPerson(db.app, userId, (tx) => attestWishTrigger(tx, { circleId: circle.circleId, event: "hospital", stance }));
const stateOf = async (circle: RealCircle, id: string) => (await serviceRows(db, circle.circleId, "select state from parent_subscriptions where id = $1", [id]))[0]?.state;

async function drain(deps: Parameters<typeof runWishSubscriptionBatch>[0]): Promise<void> {
  while ((await runWishSubscriptionBatch(deps, log)) > 0);
}

describe("her wishes' subscriptions, through PayPal", () => {
  it("suspends a real subscription and records it only once PayPal's record says so, then resumes it when she is home", async () => {
    const pool = fakePool({ now: () => CLOCK });
    const { circle, gymId, paypalId, amara } = await circleWithRealGym(pool);
    await attest(circle.userId, circle, "start");
    await attest(amara, circle, "start");
    // The real one waits for PayPal; the demo's simulated magazine is already suspended.
    expect(await stateOf(circle, gymId)).toBe("suspending");
    const deps = { db: db.service, pool, now: () => CLOCK };
    await drain(deps);
    expect(pool.subscriptions.get(paypalId)?.status).toBe("SUSPENDED");
    expect(await stateOf(circle, gymId)).toBe("suspended");
    // Leased again, nothing more is asked of PayPal.
    const asked = pool.requestIds.length;
    await drain(deps);
    expect(pool.requestIds.length).toBe(asked);

    await attest(circle.userId, circle, "end");
    await attest(amara, circle, "end");
    expect(await stateOf(circle, gymId)).toBe("resuming");
    await drain(deps);
    expect(pool.subscriptions.get(paypalId)?.status).toBe("ACTIVE");
    expect(await stateOf(circle, gymId)).toBe("active");
  });

  it("puts a suspension PayPal refused back as it was, and never records it as done", async () => {
    const pool = fakePool({ now: () => CLOCK });
    const { circle, gymId, paypalId, amara } = await circleWithRealGym(pool);
    const stored = pool.subscriptions.get(paypalId);
    if (stored) stored.status = "APPROVAL_PENDING";
    await attest(circle.userId, circle, "start");
    await attest(amara, circle, "start");
    await drain({ db: db.service, pool, now: () => CLOCK });
    expect(await stateOf(circle, gymId)).toBe("active");
    expect(lines).toContainEqual(expect.objectContaining({ message: "wish_subscription.suspend.refused" }));
  });

  it("checks again that the subscription is Rose's before asking PayPal anything, and never touches one that is not", async () => {
    const pool = fakePool({ now: () => CLOCK });
    const { circle, gymId, paypalId, amara } = await circleWithRealGym(pool);
    const stored = pool.subscriptions.get(paypalId);
    // PayPal now says it is someone else's: another circle's member, and no subscriber Kin knows.
    if (stored) stored.reference = { circleId: "0b6f4c3e-8d1a-4f6e-9c2b-5a7d3e1f9a40", memberId: circle.members.rose };
    await attest(circle.userId, circle, "start");
    await attest(amara, circle, "start");
    const asked = pool.requestIds.length;
    await drain({ db: db.service, pool, now: () => CLOCK });
    expect(pool.requestIds.length).toBe(asked);
    expect(pool.subscriptions.get(paypalId)?.status).toBe("ACTIVE");
    expect(await stateOf(circle, gymId)).toBe("active");
    expect(lines).toContainEqual(expect.objectContaining({ message: "wish_subscription.suspend.not_owned" }));
  });

  it("waits and reads again while PayPal cannot be reached, instead of guessing", async () => {
    const pool = fakePool({ now: () => CLOCK });
    const { circle, gymId, amara } = await circleWithRealGym(pool);
    await attest(circle.userId, circle, "start");
    await attest(amara, circle, "start");
    pool.failNext = "getSubscription";
    await runWishSubscriptionBatch({ db: db.service, pool, now: () => CLOCK }, log);
    expect(await stateOf(circle, gymId)).toBe("suspending");
    expect(lines).toContainEqual(expect.objectContaining({ message: "wish_subscription.retry" }));
  });
});
