import {
  PAYOUT_TOPIC,
  answerProposal,
  asPerson,
  asService,
  claimOutbox,
  configureCaregiver,
  readLedger,
  sendCaregiverBill,
  submitCaregiverBill,
  takeDemoSeat,
} from "@kin/db";
import { personQuery, seatPerson, serviceRows, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { accountBalance, cashAvailableForPayouts, payableAccount } from "@kin/domain";
import { fakePool, type FakePool } from "@kin/paypal/testing";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

import { executePayout, type PayoutDeps } from "./execute-payout.ts";
import { runPayoutBatch } from "./run-payouts.ts";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");
const FEE = 25;
const RECEIVER = "amara@personal.example.com";
const silent: InboxLog = () => {};

type Payout = { circle: VisitorCircle; pool: FakePool; deps: PayoutDeps; proposalId: string; billId: string; executionId: string };

/**
 * Rose's circle, where Amara bills three four-hour days at 22.00 (264.00),
 * Elena sends the bill, and Rose approves it. `real` turns the provisioned
 * circle into a real one first (test scaffolding only: no screen makes a
 * real circle's agreement yet), so its yes carries step-up evidence and the
 * payout goes to the PayPal fake instead of being simulated.
 */
async function approvedPayout(options: { real?: boolean; receiver?: string | null; rateCentsPerHour?: number; minutes?: number } = {}): Promise<Payout> {
  const circle = await visitorWithCircle(db);
  const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
  const rate = options.rateCentsPerHour ?? 2200;
  await asPerson(db.app, circle.userId, (tx) => configureCaregiver(tx, { circleId: circle.circleId, memberId: circle.members.amara, payeeId: circle.payees.amara, name: "Amara", rateCentsPerHour: rate }));
  const visits = options.minutes ? [{ date: "2026-10-20", minutes: options.minutes }] : ["2026-10-20", "2026-10-21", "2026-10-22"].map((date) => ({ date, minutes: 240 }));
  const billId = await asPerson(db.app, caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details: { version: 1, currency: "USD", rateCentsPerHour: rate, visits }, submissionKey: randomUUID() }));
  const proposalId = await asPerson(db.app, circle.userId, (tx) => sendCaregiverBill(tx, { circleId: circle.circleId, billId, now: CLOCK }));
  const receiver = options.receiver === undefined ? (options.real ? RECEIVER : null) : options.receiver;
  // Rose's seat is taken while the circle is still a demo, where seats can change hands.
  await asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members.rose));
  if (receiver !== null) await serviceRows(db, circle.circleId, "update payees set paypal_receiver = $1 where id = $2", [receiver, circle.payees.amara]);
  if (options.real) await serviceRows(db, circle.circleId, "update circles set demo = false, clock_at = null where id = $1", [circle.circleId]);
  const decision = await asPerson(db.app, circle.userId, (tx) =>
    answerProposal(tx, { circleId: circle.circleId, memberId: circle.members.rose, role: "parent" }, {
      proposalId, decision: "approve", method: "app", now: CLOCK, pausedUntil: null,
      evidenceRef: options.real ? "cognito:jti-rose:1793000000:pwd+otp+mfa" : null,
    }),
  );
  expect(decision).toBe("approved");
  const pool = fakePool();
  const executionId = await executionOf(circle.circleId, proposalId);
  return { circle, pool, deps: { db: db.service, pool, now: () => CLOCK, feeReserve: () => FEE }, proposalId, billId, executionId };
}

const row = async (circleId: string, query: string, id: string) => (await serviceRows(db, circleId, query, [id]))[0];
const executionOf = async (circleId: string, proposalId: string) => String((await row(circleId, "select id from executions where proposal_id = $1", proposalId))?.id);
const states = async (payout: Payout) => ({
  execution: (await row(payout.circle.circleId, "select state from executions where id = $1", payout.executionId))?.state,
  proposal: (await row(payout.circle.circleId, "select state from proposals where id = $1", payout.proposalId))?.state,
  bill: (await row(payout.circle.circleId, "select state from bills where id = $1", payout.billId))?.state,
});
const ledgerOf = (circleId: string) => asService(db.service, circleId, (tx) => readLedger(tx, { id: circleId, currency: "USD" }));
const entriesFor = async (payout: Payout) =>
  (await ledgerOf(payout.circle.circleId)).entries.filter((entry) => entry.source.id === payout.proposalId || entry.source.id.startsWith("simulated-payout-") || [...payout.pool.payouts.values()].some((made) => made.batch.items[0]?.itemId === entry.source.id));
const step = (payout: Payout) => executePayout(payout.deps, payout.circle.circleId, payout.executionId);

describe("an approved caregiver payout", () => {
  it("is queued in the approval's own transaction: one execution keyed by the proposal, and one outbox message", async () => {
    const payout = await approvedPayout();
    expect(await row(payout.circle.circleId, "select idempotency_key, state from executions where id = $1", payout.executionId)).toEqual({ idempotency_key: `kin-payout-${payout.proposalId}`, state: "created" });
    const messages = await serviceRows(db, payout.circle.circleId, "select topic, payload from outbox where circle_id = $1 and sent_at is null", [payout.circle.circleId]);
    expect(messages).toEqual([{ topic: PAYOUT_TOPIC, payload: { executionId: payout.executionId } }]);
  });

  it("is paid in a demo circle as a simulated payout, labelled so, without calling PayPal", async () => {
    const payout = await approvedPayout();
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect(await states(payout)).toEqual({ execution: "confirmed", proposal: "settled", bill: "paid" });
    expect(payout.pool.payouts.size).toBe(0);
    const entries = await entriesFor(payout);
    expect(entries.map((entry) => [entry.kind, entry.simulated])).toEqual([["bill_approved", true], ["payout_confirmed", true]]);
    expect(accountBalance(await ledgerOf(payout.circle.circleId), payableAccount(payout.circle.payees.amara))).toBe(0);
  });

  it("is paid in a real circle only once PayPal's record says the item succeeded, with PayPal's own fee", async () => {
    const payout = await approvedPayout({ real: true });
    const before = await ledgerOf(payout.circle.circleId);
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });

    const [made] = [...payout.pool.payouts.values()];
    expect(made?.request).toEqual({ senderBatchId: `kin-payout-${payout.proposalId}`, receiver: RECEIVER, amount: { cents: 26_400, currency: "USD" }, note: expect.any(String) });
    expect(payout.pool.requestIds).toEqual([`kin-payout-${payout.proposalId}`]);
    expect(await states(payout)).toEqual({ execution: "confirmed", proposal: "settled", bill: "paid" });
    const after = await ledgerOf(payout.circle.circleId);
    expect(accountBalance(after, "pool_cash") - accountBalance(before, "pool_cash")).toBe(-(26_400 + 25));
    expect(accountBalance(after, "fees") - accountBalance(before, "fees")).toBe(25);
    const entries = await entriesFor(payout);
    expect(entries.map((entry) => [entry.kind, entry.simulated, entry.source.type])).toEqual([["bill_approved", false, "approval"], ["payout_confirmed", false, "paypal_event"]]);
  });

  it("waits while PayPal holds it pending, and confirms when PayPal's record later says success", async () => {
    const payout = await approvedPayout({ real: true });
    payout.pool.payoutStatus = "PENDING";
    expect(await step(payout)).toMatchObject({ next: "later", result: "pending" });
    expect(await states(payout)).toEqual({ execution: "pending_at_paypal", proposal: "executing", bill: "proposed" });
    expect((await entriesFor(payout)).map((entry) => entry.kind)).toEqual(["bill_approved"]);

    const [batchId] = [...payout.pool.payouts.keys()];
    if (!batchId) throw new Error("No payout was made");
    payout.pool.settlePayout(batchId, "SUCCESS");
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect(payout.pool.payouts.size).toBe(1);
  });

  it("becomes unknown when PayPal's answer is lost, then finds the payout PayPal made, and never pays twice", async () => {
    const payout = await approvedPayout({ real: true });
    payout.pool.loseNextReply = "createPayout";
    expect(await step(payout)).toMatchObject({ next: "later", result: "unknown" });
    expect((await states(payout)).execution).toBe("unknown");
    expect((await entriesFor(payout)).map((entry) => entry.kind)).toEqual(["bill_approved"]);

    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect(payout.pool.payouts.size).toBe(1);
    expect((await entriesFor(payout)).map((entry) => entry.kind)).toEqual(["bill_approved", "payout_confirmed"]);
  });

  it("asks again with the same key when PayPal could not be reached, and pays once", async () => {
    const payout = await approvedPayout({ real: true });
    payout.pool.failNext = "createPayout";
    expect(await step(payout)).toMatchObject({ result: "unknown" });
    expect(payout.pool.payouts.size).toBe(0);
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect(payout.pool.payouts.size).toBe(1);
    expect(new Set(payout.pool.requestIds)).toEqual(new Set([`kin-payout-${payout.proposalId}`]));
  });

  it("fails when PayPal refuses it or returns the item, leaving the caregiver owed and the bill unpaid", async () => {
    const refused = await approvedPayout({ real: true });
    refused.pool.refuseNextPayout = "INSUFFICIENT_FUNDS";
    expect(await step(refused)).toEqual({ next: "done", result: "failed" });
    expect(await states(refused)).toEqual({ execution: "failed", proposal: "failed", bill: "proposed" });

    const returned = await approvedPayout({ real: true });
    returned.pool.payoutStatus = "RETURNED";
    expect(await step(returned)).toEqual({ next: "done", result: "failed" });
    const ledger = await ledgerOf(returned.circle.circleId);
    expect(accountBalance(ledger, payableAccount(returned.circle.payees.amara))).toBe(26_400);
    expect(await row(returned.circle.circleId, "select last_error from executions where id = $1", returned.executionId)).toEqual({ last_error: "paypal_returned" });
  });

  it("waits, recorded once, while a real payee has no PayPal address, and pays once one is recorded", async () => {
    const payout = await approvedPayout({ real: true, receiver: null });
    expect(await step(payout)).toMatchObject({ next: "later", result: "held" });
    expect(await step(payout)).toMatchObject({ next: "later", result: "held" });
    expect(await states(payout)).toEqual({ execution: "created", proposal: "approved", bill: "proposed" });
    const held = await serviceRows(db, payout.circle.circleId, "select details from audit_log where subject_id = $1 and action = 'payout.held'", [payout.executionId]);
    expect(held).toEqual([{ details: { reason: "no_receiver" } }]);
    expect(await entriesFor(payout)).toEqual([]);

    await serviceRows(db, payout.circle.circleId, "update payees set paypal_receiver = $1 where id = $2", [RECEIVER, payout.circle.payees.amara]);
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
  });

  it("pays the address fixed when the family approved, whatever the payee's address says later", async () => {
    const payout = await approvedPayout({ real: true });
    // Written as the service, past every screen's lock, to show the execution does not follow it.
    await serviceRows(db, payout.circle.circleId, "update payees set paypal_receiver = $1 where id = $2", ["thief@example.com", payout.circle.payees.amara]);
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect([...payout.pool.payouts.values()].map((made) => made.request.receiver)).toEqual([RECEIVER]);
  });

  it("cannot be pointed at another address once it has one, even by the service", async () => {
    const payout = await approvedPayout({ real: true });
    await expect(serviceRows(db, payout.circle.circleId, "update executions set receiver = $1 where id = $2", ["thief@example.com", payout.executionId])).rejects.toThrow();
  });

  it("never pays out money that has not arrived: it waits while the pool cannot cover the bill and the fee", async () => {
    const probe = await visitorWithCircle(db);
    const available = cashAvailableForPayouts(await ledgerOf(probe.circleId));
    // One ten-hour day valued just above what the pool can pay.
    const rate = Math.ceil(((available + 1) * 60) / 600);
    const payout = await approvedPayout({ real: true, rateCentsPerHour: rate, minutes: 600 });
    expect(await step(payout)).toMatchObject({ next: "later", result: "held" });
    expect(payout.pool.payouts.size).toBe(0);
    expect(await entriesFor(payout)).toEqual([]);
  });

  it("sends nothing while the circle is paused, and pays once the pause lifts", async () => {
    const payout = await approvedPayout({ real: true });
    const pause = (until: Date | null) =>
      serviceRows(db, payout.circle.circleId, "update circles set paused_until = $1, paused_by = $2 where id = $3", [until, until ? payout.circle.members.marcus : null, payout.circle.circleId]);
    await pause(new Date(CLOCK.getTime() + 3_600_000));
    expect(await step(payout)).toMatchObject({ next: "later", result: "held" });
    expect(payout.pool.payouts.size).toBe(0);
    expect(await states(payout)).toEqual({ execution: "created", proposal: "approved", bill: "proposed" });
    expect(await serviceRows(db, payout.circle.circleId, "select details from audit_log where subject_id = $1 and action = 'payout.held'", [payout.executionId])).toEqual([{ details: { reason: "paused" } }]);

    await pause(null);
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
  });

  it("keeps tracking a payout already at PayPal through a pause", async () => {
    const payout = await approvedPayout({ real: true });
    payout.pool.payoutStatus = "PENDING";
    await step(payout);
    await serviceRows(db, payout.circle.circleId, "update circles set paused_until = $1, paused_by = $2 where id = $3", [new Date(CLOCK.getTime() + 3_600_000), payout.circle.members.marcus, payout.circle.circleId]);
    const [batchId] = [...payout.pool.payouts.keys()];
    if (!batchId) throw new Error("No payout was made");
    payout.pool.settlePayout(batchId, "SUCCESS");
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
  });

  it("refuses a batch PayPal links that is not this execution's", async () => {
    const payout = await approvedPayout({ real: true });
    payout.pool.payoutStatus = "PENDING";
    await step(payout);
    const [stored] = [...payout.pool.payouts.values()];
    if (!stored) throw new Error("No payout was made");
    stored.batch = { ...stored.batch, senderBatchId: "someone-else" };
    await expect(step(payout)).rejects.toThrow(/does not match/);
    expect((await states(payout)).execution).toBe("pending_at_paypal");
  });
});

describe("the worker's payout loop", () => {
  it("takes the approved payout from the outbox, pays it, and marks the message sent", async () => {
    const payout = await approvedPayout();
    // Other tests' circles share the outbox; the loop works through all of them.
    while ((await runPayoutBatch(payout.deps, silent)) > 0);
    expect((await states(payout)).execution).toBe("confirmed");
    const sent = await serviceRows(db, payout.circle.circleId, "select sent_at is not null as sent from outbox where circle_id = $1", [payout.circle.circleId]);
    expect(sent).toEqual([{ sent: true }]);
  });

  it("is the only reader of every circle's outbox: a person's identity cannot lease it", async () => {
    const circle = await visitorWithCircle(db);
    await expect(personQuery(db, circle.userId, `select * from kin_private.claim_outbox('${PAYOUT_TOPIC}', 5, 60)`)).rejects.toThrow();
    await expect(claimOutbox(db.app, PAYOUT_TOPIC, 5, 60)).rejects.toThrow();
  });

  it("hides a leased message from a second worker until the lease ends", async () => {
    const payout = await approvedPayout();
    const mine = (messages: { circleId: string }[]) => messages.filter((message) => message.circleId === payout.circle.circleId);
    let first: { circleId: string }[] = [];
    // Other circles' messages may come first; lease until this circle's is taken.
    for (let tries = 0; tries < 50 && mine(first).length === 0; tries += 1) first = await claimOutbox(db.service, PAYOUT_TOPIC, 100, 600);
    expect(mine(first)).toHaveLength(1);
    expect(mine(await claimOutbox(db.service, PAYOUT_TOPIC, 100, 600))).toHaveLength(0);
    expect(await serviceRows(db, payout.circle.circleId, "select attempts from outbox where circle_id = $1", [payout.circle.circleId])).toEqual([{ attempts: 1 }]);
  });
});
