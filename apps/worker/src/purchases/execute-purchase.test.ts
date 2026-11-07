import {
  PURCHASE_TOPIC,
  RefillError,
  answerProposal,
  asPerson,
  asService,
  proposeRefill,
  readAccountIds,
  readLedger,
  takeDemoSeat,
  writeEntries,
} from "@kin/db";
import { personQuery, seatPerson, serviceRows, snapshotFor, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { DELIVERY_SCHEDULE_SECONDS, accountBalance, calendarDay, purchaseCaptured } from "@kin/domain";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

import { executePurchase, followDelivery, type PurchaseDeps } from "./execute-purchase.ts";
import { MerchantError, httpMerchant, simulatedMerchant, type Merchant } from "./merchant.ts";
import { runDeliveryBatch, runPurchaseBatch } from "./run-purchases.ts";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");
const silent: InboxLog = () => {};
const REAL_START = new Date("2026-11-07T10:00:00Z");

type Refill = { circle: VisitorCircle; ruleId: string; proposalId: string };

const deps = (merchant: Merchant = simulatedMerchant, at: Date = REAL_START): PurchaseDeps => ({ db: db.service, merchant, now: () => at });
const row = async (circleId: string, query: string, id: string) => (await serviceRows(db, circleId, query, [id]))[0];
const ledgerOf = (circleId: string) => asService(db.service, circleId, (tx) => readLedger(tx, { id: circleId, currency: "USD" }));

async function ruleOf(circle: VisitorCircle): Promise<string> {
  const snapshot = await snapshotFor(db, circle.userId, circle.circleId);
  const [rule] = snapshot.purchaseRules;
  if (!rule) throw new Error("The demo circle has no refill rule");
  return rule.id;
}

const raise = (circle: VisitorCircle, ruleId: string) => asPerson(db.app, circle.userId, (tx) => proposeRefill(tx, { circleId: circle.circleId, ruleId, now: CLOCK }));

/** Elena asks Kin for the refill, then Rose says yes by voice from her own seat. */
async function approvedRefill(): Promise<Refill & { executionId: string }> {
  const circle = await visitorWithCircle(db);
  const ruleId = await ruleOf(circle);
  const proposalId = await raise(circle, ruleId);
  await asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members.rose));
  const decision = await asPerson(db.app, circle.userId, (tx) =>
    answerProposal(tx, { circleId: circle.circleId, memberId: circle.members.rose, role: "parent" }, { proposalId, decision: "approve", method: "voice", evidenceRef: "voice:abc123", now: CLOCK, pausedUntil: null }),
  );
  expect(decision).toBe("approved");
  const executionId = String((await row(circle.circleId, "select id from executions where proposal_id = $1", proposalId))?.id);
  return { circle, ruleId, proposalId, executionId };
}

describe("a refill Kin proposes", () => {
  it("waits for Rose's yes, is raised by Kin and never by a typed amount, and a retry returns the same proposal", async () => {
    const circle = await visitorWithCircle(db);
    const ruleId = await ruleOf(circle);
    const proposalId = await raise(circle, ruleId);
    expect(await raise(circle, ruleId)).toBe(proposalId);

    const proposal = await row(circle.circleId, "select kind, cents, state, raised_by, purpose, plan from proposals where id = $1", proposalId);
    expect(proposal).toMatchObject({ kind: "purchase", cents: "6400", state: "pending_approval", raised_by: null, purpose: "refill" });
    expect(proposal?.plan).toMatchObject({ outcome: "needs_approval", slots: [{ reason: "parent_decides", roles: ["parent"] }] });
    expect(await row(circle.circleId, "select state, cents from purchases where proposal_id = $1", proposalId)).toEqual({ state: "awaiting", cents: "6400" });
    expect(await row(circle.circleId, "select count(*)::int as n from executions where proposal_id = $1", proposalId)).toEqual({ n: 0 });
  });

  it("is refused for a caregiver and an observer, who answer and ask nothing", async () => {
    const circle = await visitorWithCircle(db);
    const ruleId = await ruleOf(circle);
    const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
    const observer = await seatPerson(db, circle.circleId, circle.members.daniel);
    for (const userId of [caregiver, observer]) {
      await expect(asPerson(db.app, userId, (tx) => proposeRefill(tx, { circleId: circle.circleId, ruleId, now: CLOCK }))).rejects.toMatchObject({ name: "RefillError" });
    }
    expect(await row(circle.circleId, "select count(*)::int as n from purchases where circle_id = $1", circle.circleId)).toEqual({ n: 0 });
  });

  it("is refused above the rule's budget for the month, and above its limit, by plain code before the database is asked", async () => {
    const refill = await approvedRefill();
    const { circle, ruleId } = refill;
    // Elena's seat went to Rose, who may also ask. 100.00 a month holds one refill of 64.00, not two.
    await serviceRows(db, circle.circleId, "update purchase_rules set monthly_budget_cents = 10000 where id = $1", [ruleId]);
    await executePurchase(deps(), circle.circleId, refill.executionId);
    await expect(raise(circle, ruleId)).rejects.toMatchObject({ reason: "over_budget" });

    await serviceRows(db, circle.circleId, "update purchase_rules set monthly_budget_cents = 150000, limit_cents = 5000 where id = $1", [ruleId]);
    await expect(raise(circle, ruleId)).rejects.toMatchObject({ reason: "above_limit" });
  });

  it("is refused in a real circle, where Kin cannot yet charge a saved wallet", async () => {
    const circle = await visitorWithCircle(db);
    const ruleId = await ruleOf(circle);
    await serviceRows(db, circle.circleId, "update circles set demo = false, clock_at = null where id = $1", [circle.circleId]);
    const error = await raise(circle, ruleId).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RefillError);
    expect(error).toMatchObject({ reason: "demo_only" });
  });

  it("is refused from a seller the family has not approved", async () => {
    const circle = await visitorWithCircle(db);
    const ruleId = await ruleOf(circle);
    await serviceRows(db, circle.circleId, "update payees set status = 'new' where id = $1", [circle.payees.pharmacy]);
    await expect(raise(circle, ruleId)).rejects.toMatchObject({ reason: "seller_not_approved" });
  });
});

describe("an approved refill", () => {
  it("is queued in the approval's own transaction: one execution keyed by the proposal and one outbox message", async () => {
    const refill = await approvedRefill();
    expect(await row(refill.circle.circleId, "select idempotency_key, state from executions where id = $1", refill.executionId)).toEqual({ idempotency_key: `kin-purchase-${refill.proposalId}`, state: "created" });
    const messages = await serviceRows(db, refill.circle.circleId, "select topic, payload from outbox where circle_id = $1 and sent_at is null", [refill.circle.circleId]);
    expect(messages).toEqual([{ topic: PURCHASE_TOPIC, payload: { executionId: refill.executionId } }]);
  });

  it("is bought in a demo circle with simulated money, labelled so, once, and the order is placed", async () => {
    const refill = await approvedRefill();
    const before = await ledgerOf(refill.circle.circleId);
    expect(await executePurchase(deps(), refill.circle.circleId, refill.executionId)).toEqual({ next: "done", result: "confirmed" });
    // A second turn of the same message buys nothing more.
    expect(await executePurchase(deps(), refill.circle.circleId, refill.executionId)).toEqual({ next: "done", result: "gone" });

    expect(await row(refill.circle.circleId, "select state from executions where id = $1", refill.executionId)).toEqual({ state: "confirmed" });
    expect(await row(refill.circle.circleId, "select state from proposals where id = $1", refill.proposalId)).toEqual({ state: "settled" });
    const after = await ledgerOf(refill.circle.circleId);
    // Rose's month already holds one captured purchase; this refill adds exactly one more, simulated.
    const captured = (ledger: typeof after) => ledger.entries.filter((entry) => entry.kind === "purchase_captured");
    expect(captured(after).length - captured(before).length).toBe(1);
    expect(captured(after).filter((entry) => entry.source.id === `simulated-purchase-${refill.executionId}`).map((entry) => entry.simulated)).toEqual([true]);
    expect(accountBalance(before, "pool_cash") - accountBalance(after, "pool_cash")).toBe(6400);
    expect(await row(refill.circle.circleId, "select state, merchant_order from purchases where proposal_id = $1", refill.proposalId)).toEqual({ state: "ordered", merchant_order: `simulated-order-kin-purchase-${refill.proposalId}` });
  });

  it("is followed to the door on the pharmacy's schedule, one recorded step at a time, and the message leaves the outbox when delivered", async () => {
    const refill = await approvedRefill();
    await executePurchase(deps(), refill.circle.circleId, refill.executionId);
    const purchase = await row(refill.circle.circleId, "select id from purchases where proposal_id = $1", refill.proposalId);
    const purchaseId = String(purchase?.id);
    const stateOf = async () => (await row(refill.circle.circleId, "select state from purchases where id = $1", purchaseId))?.state;
    const at = (seconds: number) => deps(simulatedMerchant, new Date(REAL_START.getTime() + seconds * 1000));

    expect(await followDelivery(at(5), refill.circle.circleId, purchaseId)).toMatchObject({ next: "later" });
    expect(await stateOf()).toBe("ordered");
    await followDelivery(at(DELIVERY_SCHEDULE_SECONDS.shipped), refill.circle.circleId, purchaseId);
    expect(await stateOf()).toBe("shipped");
    // A long gap between looks is recorded as every step it covered.
    expect(await followDelivery(at(DELIVERY_SCHEDULE_SECONDS.delivered + 10), refill.circle.circleId, purchaseId)).toEqual({ next: "done" });
    expect(await stateOf()).toBe("delivered");
    const steps = await serviceRows(db, refill.circle.circleId, "select details->>'state' as state from audit_log where action = 'purchase.delivery' and circle_id = $1 order by sequence", [refill.circle.circleId]);
    expect(steps.map((each) => each.state)).toEqual(["shipped", "out_for_delivery", "delivered"]);
  });

  it("is carried by the outbox runners: bought on one turn, delivered when the order's time has come", async () => {
    const refill = await approvedRefill();
    expect(await runPurchaseBatch(deps(), silent)).toBeGreaterThanOrEqual(1);
    expect((await row(refill.circle.circleId, "select state from proposals where id = $1", refill.proposalId))?.state).toBe("settled");
    // The delivery message is not due until the first look, so a turn now finds none of this circle's.
    const later = deps(simulatedMerchant, new Date(Date.now() + 10 * 60_000));
    await serviceRows(db, refill.circle.circleId, "update outbox set available_at = now() - interval '1 second' where topic = 'purchase.deliver' and circle_id = $1", [refill.circle.circleId]);
    await runDeliveryBatch(later, silent);
    expect((await row(refill.circle.circleId, "select state from purchases where proposal_id = $1", refill.proposalId))?.state).toBe("delivered");
  });

  it("is held, changing nothing, while the circle is paused, and while the pool lacks the money", async () => {
    const paused = await approvedRefill();
    await serviceRows(db, paused.circle.circleId, "update circles set paused_until = clock_at + interval '2 hours', paused_by = $2 where id = $1", [paused.circle.circleId, paused.circle.members.rose]);
    expect(await executePurchase(deps(), paused.circle.circleId, paused.executionId)).toMatchObject({ next: "later", result: "held" });
    expect(await row(paused.circle.circleId, "select state from proposals where id = $1", paused.proposalId)).toEqual({ state: "approved" });

    const poor = await approvedRefill();
    // Spend the pool down to less than a refill, as a bill paid from it would.
    const cash = accountBalance(await ledgerOf(poor.circle.circleId), "pool_cash");
    const drain = purchaseCaptured(
      { id: randomUUID(), circleId: poor.circle.circleId, ...calendarDay(CLOCK, "America/New_York"), source: { type: "approval", id: randomUUID() }, currency: "USD", simulated: true, description: "Spent before the refill" },
      { category: "pharmacy", cents: cash - 100 },
    );
    await asService(db.service, poor.circle.circleId, async (tx) => writeEntries(tx, [drain], await readAccountIds(tx, poor.circle.circleId)));
    expect(await executePurchase(deps(), poor.circle.circleId, poor.executionId)).toMatchObject({ next: "later", result: "held" });
    expect(await row(poor.circle.circleId, "select state from proposals where id = $1", poor.proposalId)).toEqual({ state: "approved" });
    const held = await serviceRows(db, poor.circle.circleId, "select details from audit_log where action = 'purchase.held' and circle_id = $1", [poor.circle.circleId]);
    expect(held.map((each) => each.details)).toEqual([{ reason: "waiting_for_funds" }]);
  });

  it("stops in a real circle: nothing is taken from the pool and the refill is marked failed", async () => {
    const refill = await approvedRefill();
    await serviceRows(db, refill.circle.circleId, "update circles set demo = false, clock_at = null where id = $1", [refill.circle.circleId]);
    expect(await executePurchase(deps(), refill.circle.circleId, refill.executionId)).toEqual({ next: "done", result: "failed" });
    expect(await row(refill.circle.circleId, "select state, last_error from executions where id = $1", refill.executionId)).toEqual({ state: "failed", last_error: "real_purchases_not_supported" });
    expect(await row(refill.circle.circleId, "select state from proposals where id = $1", refill.proposalId)).toEqual({ state: "failed" });
    expect((await ledgerOf(refill.circle.circleId)).entries.some((entry) => entry.source.id.includes(refill.executionId))).toBe(false);
  });

  it("fails when the seller refuses, and is tried again when the seller cannot be reached", async () => {
    const refused = await approvedRefill();
    const refusing: Merchant = { ...simulatedMerchant, placeOrder: async () => { throw new MerchantError(false); } };
    expect(await executePurchase(deps(refusing), refused.circle.circleId, refused.executionId)).toEqual({ next: "done", result: "failed" });
    expect((await row(refused.circle.circleId, "select last_error from executions where id = $1", refused.executionId))?.last_error).toBe("seller_refused");

    const away = await approvedRefill();
    const unreachable: Merchant = { ...simulatedMerchant, placeOrder: async () => { throw new MerchantError(true); } };
    await expect(executePurchase(deps(unreachable), away.circle.circleId, away.executionId)).rejects.toBeInstanceOf(MerchantError);
    // Nothing was written: the proposal is still waiting to be bought.
    expect(await row(away.circle.circleId, "select state from proposals where id = $1", away.proposalId)).toEqual({ state: "approved" });
    expect(await executePurchase(deps(), away.circle.circleId, away.executionId)).toEqual({ next: "done", result: "confirmed" });
  });
});

describe("what a person may read and write of purchases", () => {
  it("lets the family read them, hides them from a caregiver, and lets nobody write them", async () => {
    const refill = await approvedRefill();
    const circleId = refill.circle.circleId;
    const family = await snapshotFor(db, refill.circle.userId, circleId);
    expect(family.purchases.map((purchase) => purchase.proposalId)).toEqual([refill.proposalId]);
    const caregiver = await seatPerson(db, circleId, refill.circle.members.amara);
    expect(await personQuery(db, caregiver, `select count(*) from purchases where circle_id = '${circleId}'`)).toMatchObject({ rows: [{ count: "0" }] });
    await expect(personQuery(db, refill.circle.userId, `update purchases set state = 'delivered' where circle_id = '${circleId}'`)).rejects.toThrow();
    await expect(personQuery(db, refill.circle.userId, `update purchase_rules set price_cents = 1 where circle_id = '${circleId}'`)).rejects.toThrow();
  });

  it("refuses a refill for a circle the person is not in", async () => {
    const mine = await visitorWithCircle(db);
    const theirs = await visitorWithCircle(db);
    const theirRule = await ruleOf(theirs);
    await expect(asPerson(db.app, mine.userId, (tx) => proposeRefill(tx, { circleId: theirs.circleId, ruleId: theirRule, now: CLOCK }))).rejects.toMatchObject({ reason: "refused" });
  });
});

describe("the demo pharmacy over HTTP", () => {
  it("places an order by key and reads its progress, trusting nothing it cannot parse", async () => {
    const replies: Response[] = [
      new Response(JSON.stringify({ ref: "order-1" }), { status: 201 }),
      new Response(JSON.stringify({ state: "shipped" }), { status: 200 }),
      new Response(JSON.stringify({ state: "teleported" }), { status: 200 }),
      new Response("oops", { status: 503 }),
      new Response(JSON.stringify({ ref: "bad ref!" }), { status: 201 }),
    ];
    const merchant = httpMerchant("http://pharmacy.test", async () => replies.shift() ?? new Response(null, { status: 500 }));
    expect(await merchant.placeOrder({ key: "k", item: "Refill", cents: 6400, currency: "USD" })).toEqual({ ref: "order-1" });
    expect(await merchant.progressOf({ ref: "order-1", placedAt: REAL_START, now: REAL_START })).toBe("shipped");
    await expect(merchant.progressOf({ ref: "order-1", placedAt: REAL_START, now: REAL_START })).rejects.toMatchObject({ retryable: true });
    await expect(merchant.progressOf({ ref: "order-1", placedAt: REAL_START, now: REAL_START })).rejects.toMatchObject({ retryable: true });
    await expect(merchant.placeOrder({ key: "k", item: "Refill", cents: 6400, currency: "USD" })).rejects.toMatchObject({ retryable: true });
  });
});
