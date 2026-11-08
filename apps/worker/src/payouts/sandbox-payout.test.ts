import { asPerson, asService, answerProposal, configureCaregiver, readAccountIds, readLedger, sendCaregiverBill, submitCaregiverBill, takeDemoSeat, writeEntries } from "@kin/db";
import { seatPerson, serviceRows, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { calendarDay, contributionReceived } from "@kin/domain";
import { fakePool, type FakePool } from "@kin/paypal/testing";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { executePayout, type PayoutDeps } from "./execute-payout.ts";
import { dailyBudget, type SandboxPayouts } from "./sandbox-route.ts";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");
const FEE = 25;
const KIN_SANDBOX = "sb-kin-payee@personal.example.com";
const VISITOR_TYPED = "visitor-typed@example.com";

type DemoPayout = { circle: VisitorCircle; pool: FakePool; deps: PayoutDeps; proposalId: string; executionId: string };

const sandboxOf = (dailyLimit = 25): SandboxPayouts => ({ payeeEmail: KIN_SANDBOX, dailyLimit, budget: dailyBudget() });

/**
 * Rose's demo circle, where Amara bills three four-hour days at 22.00
 * (264.00), Elena sends the bill and Rose approves it through the approval
 * engine. `receiver` is the address the visitor typed for Amara.
 */
async function demoPayout(options: { sandbox?: SandboxPayouts; receiver?: string | null; pool?: FakePool; rateCentsPerHour?: number; minutes?: number; approve?: boolean } = {}): Promise<DemoPayout> {
  const circle = await visitorWithCircle(db);
  const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
  const rate = options.rateCentsPerHour ?? 2200;
  await asPerson(db.app, circle.userId, (tx) => configureCaregiver(tx, { circleId: circle.circleId, memberId: circle.members.amara, payeeId: circle.payees.amara, name: "Amara", rateCentsPerHour: rate }));
  const visits = options.minutes ? [{ date: "2026-10-20", minutes: options.minutes }] : ["2026-10-20", "2026-10-21", "2026-10-22"].map((date) => ({ date, minutes: 240 }));
  const billId = await asPerson(db.app, caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details: { version: 1, currency: "USD", rateCentsPerHour: rate, visits }, submissionKey: randomUUID() }));
  const proposalId = await asPerson(db.app, circle.userId, (tx) => sendCaregiverBill(tx, { circleId: circle.circleId, billId, now: CLOCK }));
  if (options.receiver) await serviceRows(db, circle.circleId, "update payees set paypal_receiver = $1 where id = $2", [options.receiver, circle.payees.amara]);
  if (options.approve === false) {
    // Past the approval engine, as only a broken service could: no member ever said yes.
    await serviceRows(db, circle.circleId, "update proposals set state = 'approved' where id = $1", [proposalId]);
  } else {
    // Rose decides; a larger bill also needs the family's other yeses.
    let decision = "pending";
    for (const [member, role] of [[circle.members.rose, "parent"], [circle.members.marcus, "contributor"], [circle.members.ana, "contributor"]] as const) {
      if (decision === "approved") break;
      await asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, member));
      decision = await asPerson(db.app, circle.userId, (tx) =>
        answerProposal(tx, { circleId: circle.circleId, memberId: member, role }, { proposalId, decision: "approve", method: "app", now: CLOCK, pausedUntil: null, evidenceRef: null }),
      );
    }
    expect(decision).toBe("approved");
  }
  const pool = options.pool ?? fakePool();
  const executionId = String((await serviceRows(db, circle.circleId, "select id from executions where proposal_id = $1", [proposalId]))[0]?.id);
  return { circle, pool, deps: { db: db.service, pool, now: () => CLOCK, feeReserve: () => FEE, sandbox: options.sandbox ?? null }, proposalId, executionId };
}

const step = (payout: DemoPayout, deps: Partial<PayoutDeps> = {}) => executePayout({ ...payout.deps, ...deps }, payout.circle.circleId, payout.executionId);
const execution = async (payout: DemoPayout) =>
  (await serviceRows(db, payout.circle.circleId, "select state, receiver, paypal_batch_id, paypal_item_id, last_error from executions where id = $1", [payout.executionId]))[0];
const auditOf = (payout: DemoPayout, action: string) => serviceRows(db, payout.circle.circleId, "select details from audit_log where subject_id = $1 and action = $2", [payout.executionId, action]);
const payoutEntries = async (payout: DemoPayout) => {
  const ledger = await asService(db.service, payout.circle.circleId, (tx) => readLedger(tx, { id: payout.circle.circleId, currency: "USD" }));
  const ours = new Set([payout.proposalId, `simulated-payout-${payout.executionId}`, ...[...payout.pool.payouts.values()].map((made) => made.batch.items[0]?.itemId)]);
  return ledger.entries.filter((entry) => ours.has(entry.source.id)).map((entry) => [entry.kind, entry.simulated, entry.source.id]);
};

describe("a demo caregiver payout with Kin's sandbox account configured", () => {
  it("stays simulated, calling no one, when no sandbox account is configured", async () => {
    const payout = await demoPayout();
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect(payout.pool.payouts.size).toBe(0);
    expect(await execution(payout)).toMatchObject({ state: "confirmed", paypal_batch_id: null, paypal_item_id: `simulated-payout-${payout.executionId}` });
    expect(await auditOf(payout, "payout.sandbox")).toEqual([]);
  });

  it("is paid through PayPal's sandbox to Kin's own account, never the address the visitor typed, and is not labelled simulated", async () => {
    const payout = await demoPayout({ sandbox: sandboxOf(), receiver: VISITOR_TYPED });
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });

    const [made] = [...payout.pool.payouts.values()];
    expect(made?.request).toEqual({ senderBatchId: `kin-payout-${payout.proposalId}`, receiver: KIN_SANDBOX, amount: { cents: 26_400, currency: "USD" }, note: expect.any(String) });
    expect(payout.pool.requestIds).toEqual([`kin-payout-${payout.proposalId}`]);
    const itemId = made?.batch.items[0]?.itemId;
    expect(await execution(payout)).toMatchObject({ state: "confirmed", paypal_batch_id: made?.batch.batchId, paypal_item_id: itemId });
    expect(await payoutEntries(payout)).toEqual([["bill_approved", true, payout.proposalId], ["payout_confirmed", false, itemId]]);
    expect(await auditOf(payout, "payout.sandbox")).toEqual([{ details: { receiver: KIN_SANDBOX } }]);
  });

  it("fixes Kin's address on an execution that had none", async () => {
    const payout = await demoPayout({ sandbox: sandboxOf() });
    await step(payout);
    expect(await execution(payout)).toMatchObject({ receiver: KIN_SANDBOX });
  });

  it("waits while PayPal holds it, and is confirmed only once PayPal's record says SUCCESS", async () => {
    const payout = await demoPayout({ sandbox: sandboxOf() });
    payout.pool.payoutStatus = "UNCLAIMED";
    expect(await step(payout)).toMatchObject({ next: "later", result: "pending" });
    expect(await execution(payout)).toMatchObject({ state: "pending_at_paypal" });
    expect((await payoutEntries(payout)).map(([kind]) => kind)).toEqual(["bill_approved"]);

    const [batchId] = [...payout.pool.payouts.keys()];
    if (!batchId) throw new Error("No payout was made");
    payout.pool.settlePayout(batchId, "SUCCESS");
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect((await payoutEntries(payout)).map(([kind, simulated]) => [kind, simulated])).toEqual([["bill_approved", true], ["payout_confirmed", false]]);
  });

  it("becomes unknown when PayPal's answer is lost, and is then found and paid once, to Kin's address, even with the setting gone", async () => {
    const payout = await demoPayout({ sandbox: sandboxOf(), receiver: VISITOR_TYPED });
    payout.pool.loseNextReply = "createPayout";
    expect(await step(payout)).toMatchObject({ next: "later", result: "unknown" });
    expect(await execution(payout)).toMatchObject({ state: "unknown" });

    // The route was recorded with the payout: a later turn keeps tracking it at PayPal, never simulating it.
    expect(await step(payout, { sandbox: null })).toEqual({ next: "done", result: "confirmed" });
    expect(payout.pool.payouts.size).toBe(1);
    expect(new Set(payout.pool.requestIds)).toEqual(new Set([`kin-payout-${payout.proposalId}`]));
    expect([...payout.pool.payouts.values()].map((made) => made.request.receiver)).toEqual([KIN_SANDBOX]);
    expect((await payoutEntries(payout)).map(([kind, simulated]) => [kind, simulated])).toEqual([["bill_approved", true], ["payout_confirmed", false]]);
  });

  it("asks again with the same key when PayPal could not be reached, to Kin's address", async () => {
    const payout = await demoPayout({ sandbox: sandboxOf(), receiver: VISITOR_TYPED });
    payout.pool.failNext = "createPayout";
    expect(await step(payout)).toMatchObject({ result: "unknown" });
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect([...payout.pool.payouts.values()].map((made) => made.request.receiver)).toEqual([KIN_SANDBOX]);
  });

  it("falls back to a simulated payout, labelled so and with PayPal's reason, when PayPal refuses it", async () => {
    const payout = await demoPayout({ sandbox: sandboxOf() });
    payout.pool.refuseNextPayout = "INSUFFICIENT_FUNDS";
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect(payout.pool.payouts.size).toBe(0);
    expect(await execution(payout)).toMatchObject({ state: "confirmed", paypal_batch_id: null, paypal_item_id: `simulated-payout-${payout.executionId}`, last_error: "paypal_422_insufficient_funds" });
    expect(await payoutEntries(payout)).toEqual([["bill_approved", true, payout.proposalId], ["payout_confirmed", true, `simulated-payout-${payout.executionId}`]]);
    expect(await auditOf(payout, "payout.sandbox_fallback")).toEqual([{ details: { reason: "paypal_422_insufficient_funds" } }]);
  });

  it("falls back to a simulated payout when PayPal's record says the item failed", async () => {
    const payout = await demoPayout({ sandbox: sandboxOf() });
    payout.pool.payoutStatus = "RETURNED";
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect(await execution(payout)).toMatchObject({ state: "confirmed", paypal_item_id: `simulated-payout-${payout.executionId}`, last_error: "paypal_returned" });
    expect((await payoutEntries(payout)).map(([kind, simulated]) => [kind, simulated])).toEqual([["bill_approved", true], ["payout_confirmed", true]]);
  });

  it("stays simulated past the cap of 500.00", async () => {
    // One ten-hour day at 50.01 an hour: 500.10, which the demo pool can pay once Marcus adds 300.00.
    const payout = await demoPayout({ sandbox: sandboxOf(), rateCentsPerHour: 5001, minutes: 600 });
    await addSimulatedMoney(payout.circle, 30_000);
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect(payout.pool.payouts.size).toBe(0);
    expect(await auditOf(payout, "payout.sandbox_skipped")).toEqual([{ details: { reason: "over_cap" } }]);
  });

  it("is made at most once per demo circle", async () => {
    const payout = await demoPayout({ sandbox: sandboxOf() });
    await serviceRows(db, payout.circle.circleId, "insert into audit_log (id, circle_id, actor, action, subject_type, subject_id, details, origin) values ($1, $2, 'service', 'payout.sandbox', 'execution', $3, '{}', 'worker')", [
      randomUUID(),
      payout.circle.circleId,
      randomUUID(),
    ]);
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect(payout.pool.payouts.size).toBe(0);
    expect(await auditOf(payout, "payout.sandbox_skipped")).toEqual([{ details: { reason: "circle_limit" } }]);
  });

  it("is made at most the daily limit of times across demo circles", async () => {
    const sandbox = sandboxOf(1);
    const pool = fakePool();
    const first = await demoPayout({ sandbox, pool });
    const second = await demoPayout({ sandbox, pool });
    await step(first);
    await step(second);
    expect([...pool.payouts.values()].map((made) => made.request.senderBatchId)).toEqual([`kin-payout-${first.proposalId}`]);
    expect(await auditOf(second, "payout.sandbox_skipped")).toEqual([{ details: { reason: "daily_limit" } }]);
  });

  it("never goes to the sandbox for a proposal no member approved", async () => {
    const payout = await demoPayout({ sandbox: sandboxOf(), approve: false });
    await step(payout);
    expect(payout.pool.payouts.size).toBe(0);
    expect(await auditOf(payout, "payout.sandbox_skipped")).toEqual([{ details: { reason: "not_approved" } }]);
  });
});

async function addSimulatedMoney(circle: VisitorCircle, cents: number): Promise<void> {
  const entry = contributionReceived(
    { id: randomUUID(), circleId: circle.circleId, ...calendarDay(CLOCK, "America/New_York"), source: { type: "paypal_event", id: `simulated-test-${randomUUID()}` }, currency: "USD", simulated: true, description: "Marcus adds money (simulated)" },
    { memberId: circle.members.marcus, grossCents: cents, feeCents: 0 },
  );
  await asService(db.service, circle.circleId, async (tx) => writeEntries(tx, [entry], await readAccountIds(tx, circle.circleId)));
}

describe("the daily sandbox budget", () => {
  it("counts each UTC day apart, and keeps only today", () => {
    const budget = dailyBudget();
    budget.spend("2026-10-30");
    budget.spend("2026-10-30");
    expect(budget.used("2026-10-30")).toBe(2);
    budget.spend("2026-10-31");
    expect(budget.used("2026-10-31")).toBe(1);
    expect(budget.used("2026-10-30")).toBe(0);
  });
});
