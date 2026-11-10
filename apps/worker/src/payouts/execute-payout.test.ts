import {
  PAYOUT_TOPIC,
  answerPresenceCheck,
  answerProposal,
  asPerson,
  asService,
  claimOutbox,
  configureCaregiver,
  newCheckToken,
  openPresenceCheck,
  proposeHelp,
  readLedger,
  readTrustedVoices,
  sendCaregiverBill,
  submitCaregiverBill,
  takeDemoSeat,
} from "@kin/db";
import { adminRun, agreeAtRate, personQuery, seatPerson, serviceRows, testDatabases, type VisitorCircle, visitorWithCircle } from "@kin/db/testing";
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
async function approvedPayout(options: { real?: boolean; receiver?: string | null; rateCentsPerHour?: number; minutes?: number; wallet?: "venmo" } = {}): Promise<Payout> {
  const circle = await visitorWithCircle(db);
  const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
  const rate = options.rateCentsPerHour ?? 2200;
  await asPerson(db.app, circle.userId, (tx) => configureCaregiver(tx, { circleId: circle.circleId, memberId: circle.members.amara, payeeId: circle.payees.amara, name: "Amara", rateCentsPerHour: rate }));
  // Kin pays only at the rate the care agreement states, so Amara's follows the rate this test bills at.
  await agreeAtRate(db, circle.circleId, circle.payees.amara, rate);
  const visits = options.minutes ? [{ date: "2026-10-20", minutes: options.minutes }] : ["2026-10-20", "2026-10-21", "2026-10-22"].map((date) => ({ date, minutes: 240 }));
  const billId = await asPerson(db.app, caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details: { version: 1, currency: "USD", rateCentsPerHour: rate, visits }, submissionKey: randomUUID() }));
  const proposalId = await asPerson(db.app, circle.userId, (tx) => sendCaregiverBill(tx, { circleId: circle.circleId, billId, now: CLOCK }));
  const receiver = options.receiver === undefined ? (options.real ? RECEIVER : null) : options.receiver;
  // Rose's seat is taken while the circle is still a demo, where seats can change hands.
  await asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members.rose));
  if (receiver !== null) await serviceRows(db, circle.circleId, "update payees set paypal_receiver = $1 where id = $2", [receiver, circle.payees.amara]);
  if (options.wallet) await serviceRows(db, circle.circleId, "update payees set payout_wallet = $1 where id = $2", [options.wallet, circle.payees.amara]);
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

  it("charges a simulated payout no fee, since PayPal charged nothing", async () => {
    const payout = await approvedPayout();
    const before = await ledgerOf(payout.circle.circleId);
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    const after = await ledgerOf(payout.circle.circleId);
    expect(accountBalance(after, "fees") - accountBalance(before, "fees")).toBe(0);
    expect(accountBalance(after, "pool_cash") - accountBalance(before, "pool_cash")).toBe(-26_400);
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

  it("sends nothing while an \"is it really you?\" check is open or after a \"not me\", without touching the pause switch, and pays once the person says it was them", async () => {
    const payout = await approvedPayout({ real: true });
    const [voice] = await asPerson(db.app, payout.circle.userId, (tx) => readTrustedVoices(tx, payout.circle.circleId));
    const token = newCheckToken();
    await asPerson(db.app, payout.circle.userId, (tx) =>
      openPresenceCheck(tx, {
        circleId: payout.circle.circleId,
        voiceId: voice?.id ?? null,
        claimedName: "Theo",
        claimedRelationship: "grandson",
        claimedCents: 200_000,
        markers: ["urgency"],
        said: ["It's Theo, I need money today."],
        locale: "en",
        token,
        alerts: { denied: "Denied.", unreachable: "Unreachable.", confirmed: "Confirmed.", unknown: "Unknown." },
      }),
    );
    expect(await step(payout)).toMatchObject({ next: "later", result: "held" });
    expect(payout.pool.payouts.size).toBe(0);
    expect(await serviceRows(db, payout.circle.circleId, "select details from audit_log where subject_id = $1 and action = 'payout.held'", [payout.executionId])).toEqual([{ details: { reason: "paused" } }]);
    // The switch a person presses is untouched: the check holds the money by itself.
    expect(await serviceRows(db, payout.circle.circleId, "select paused_until from circles where id = $1", [payout.circle.circleId])).toEqual([{ paused_until: null }]);

    await answerPresenceCheck(db.app, { token, answer: "me" });
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
  });

  it("stays held for a day after the person says it was not them", async () => {
    const payout = await approvedPayout({ real: true });
    const [voice] = await asPerson(db.app, payout.circle.userId, (tx) => readTrustedVoices(tx, payout.circle.circleId));
    const token = newCheckToken();
    await asPerson(db.app, payout.circle.userId, (tx) =>
      openPresenceCheck(tx, {
        circleId: payout.circle.circleId,
        voiceId: voice?.id ?? null,
        claimedName: "Theo",
        claimedRelationship: "grandson",
        claimedCents: 200_000,
        markers: [],
        said: ["It's Theo."],
        locale: "en",
        token,
        alerts: { denied: "Denied.", unreachable: "Unreachable.", confirmed: "Confirmed.", unknown: "Unknown." },
      }),
    );
    await answerPresenceCheck(db.app, { token, answer: "not_me" });
    expect(await step(payout)).toMatchObject({ next: "later", result: "held" });
    expect(payout.pool.payouts.size).toBe(0);
  });

  describe("help for a family member who said it was really them", () => {
    const ALERTS = { denied: "Denied.", unreachable: "Unreachable.", confirmed: "Confirmed.", unknown: "Unknown." };

    /** Theo says it was him; Elena raises help; Rose approves it. The demo circle's stand-in has confirmed his account. */
    async function approvedHelp(options: { answer?: "me" | "not_me" } = {}): Promise<Payout & { token: string }> {
      const circle = await visitorWithCircle(db);
      const [voice] = await asPerson(db.app, circle.userId, (tx) => readTrustedVoices(tx, circle.circleId));
      const token = newCheckToken();
      const { checkId } = await asPerson(db.app, circle.userId, (tx) =>
        openPresenceCheck(tx, { circleId: circle.circleId, voiceId: voice?.id ?? null, claimedName: "Theo", claimedRelationship: "grandson", claimedCents: 200_000, markers: [], said: ["It's Theo, I need $200."], locale: "en", token, alerts: ALERTS }),
      );
      await answerPresenceCheck(db.app, { token, answer: "me" });
      const proposalId = await asPerson(db.app, circle.userId, (tx) => proposeHelp(tx, { circleId: circle.circleId, checkId, cents: 20_000, note: "Help for Theo.", now: CLOCK }));
      await asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members.rose));
      const decision = await asPerson(db.app, circle.userId, (tx) =>
        answerProposal(tx, { circleId: circle.circleId, memberId: circle.members.rose, role: "parent" }, { proposalId, decision: "approve", method: "app", now: CLOCK, pausedUntil: null, evidenceRef: null }),
      );
      expect(decision).toBe("approved");
      const pool = fakePool();
      const executionId = await executionOf(circle.circleId, proposalId);
      const payout = { circle, pool, deps: { db: db.service, pool, now: () => CLOCK, feeReserve: () => FEE }, proposalId, billId: "", executionId, token };
      if (options.answer === "not_me") await answerPresenceCheck(db.app, { token, answer: "not_me" });
      return payout;
    }

    it("is paid, once approved, to the account the person confirmed, and recorded as help, not as a caregiver's pay", async () => {
      const payout = await approvedHelp();
      expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
      expect(await row(payout.circle.circleId, "select state from executions where id = $1", payout.executionId)).toEqual({ state: "confirmed" });
      const descriptions = (await ledgerOf(payout.circle.circleId)).entries.filter((entry) => entry.source.id === payout.proposalId || entry.source.id.startsWith("simulated-payout-")).map((entry) => entry.description);
      expect(descriptions).toEqual(expect.arrayContaining(["Help for a family member approved by the family", "Family member helped (simulated)"]));
    });

    it("is held, and never paid, if the account it was approved for is no longer the one the person confirmed", async () => {
      const payout = await approvedHelp();
      // A payout is fixed to the address the family approved. If the person's confirmed account is anything else by the time it
      // would be sent (the database refuses the change while help is moving; a row set by the owner is still stopped here), it waits.
      await adminRun(db, "update trusted_voices set paypal_receiver = 'someone.else@personal.example.com' where circle_id = $1 and paypal_receiver is not null", [payout.circle.circleId]);
      expect(await step(payout)).toMatchObject({ next: "later", result: "held" });
      expect(await serviceRows(db, payout.circle.circleId, "select details from audit_log where subject_id = $1 and action = 'payout.held'", [payout.executionId])).toEqual([{ details: { reason: "not_verified" } }]);
      expect(await row(payout.circle.circleId, "select state from executions where id = $1", payout.executionId)).toEqual({ state: "created" });
      expect(payout.pool.payouts.size).toBe(0);
    });

    it("is held when the person says it was not them after it was approved, even once the day's hold has passed", async () => {
      const payout = await approvedHelp({ answer: "not_me" });
      await adminRun(db, "update presence_checks set hold_until = null where circle_id = $1", [payout.circle.circleId]);
      expect(await step(payout)).toMatchObject({ next: "later", result: "held" });
      expect(payout.pool.payouts.size).toBe(0);
    });
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

const VENMO_PHONE = "+15555550123";

describe("an approved caregiver payout to Venmo", () => {
  const venmoPayout = (options: { receiver?: string; real?: boolean } = {}) => approvedPayout({ real: options.real ?? true, wallet: "venmo", receiver: options.receiver ?? VENMO_PHONE });
  const walletOfExecution = async (payout: Payout) => (await row(payout.circle.circleId, "select wallet from executions where id = $1", payout.executionId))?.wallet;

  it("is pinned to Venmo when queued, sent to PayPal as a Venmo payout, and paid only once PayPal's record says SUCCESS", async () => {
    const payout = await venmoPayout();
    expect(await walletOfExecution(payout)).toBe("venmo");
    const before = await ledgerOf(payout.circle.circleId);
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });

    const [made] = [...payout.pool.payouts.values()];
    expect(made?.request).toEqual({ senderBatchId: `kin-payout-${payout.proposalId}`, receiver: VENMO_PHONE, amount: { cents: 26_400, currency: "USD" }, note: expect.any(String), wallet: "VENMO" });
    expect(made?.batch.items[0]?.wallet).toBe("VENMO");
    expect(await states(payout)).toEqual({ execution: "confirmed", proposal: "settled", bill: "paid" });
    const after = await ledgerOf(payout.circle.circleId);
    expect(accountBalance(after, "pool_cash") - accountBalance(before, "pool_cash")).toBe(-(26_400 + 25));
    expect((await entriesFor(payout)).map((entry) => [entry.kind, entry.simulated])).toEqual([["bill_approved", false], ["payout_confirmed", false]]);
  });

  it("also pays a Venmo handle", async () => {
    const payout = await venmoPayout({ receiver: "@amara-k" });
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect([...payout.pool.payouts.values()].map((made) => made.request.receiver)).toEqual(["@amara-k"]);
  });

  it("waits while the Venmo item is unclaimed, writes nothing to the ledger, and checks again until PayPal says SUCCESS", async () => {
    const payout = await venmoPayout();
    payout.pool.payoutStatus = "UNCLAIMED";
    expect(await step(payout)).toMatchObject({ next: "later", result: "pending" });
    expect(await step(payout)).toMatchObject({ next: "later", result: "pending" });
    expect(await states(payout)).toEqual({ execution: "pending_at_paypal", proposal: "executing", bill: "proposed" });
    expect((await entriesFor(payout)).map((entry) => entry.kind)).toEqual(["bill_approved"]);
    expect(payout.pool.payouts.size).toBe(1);

    const [batchId] = [...payout.pool.payouts.keys()];
    if (!batchId) throw new Error("No payout was made");
    payout.pool.settlePayout(batchId, "SUCCESS");
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect((await entriesFor(payout)).map((entry) => entry.kind)).toEqual(["bill_approved", "payout_confirmed"]);
  });

  it("fails a returned or failed Venmo item, leaving the caregiver owed and no payout in the ledger", async () => {
    for (const status of ["RETURNED", "FAILED"] as const) {
      const payout = await venmoPayout();
      payout.pool.payoutStatus = status;
      expect(await step(payout)).toEqual({ next: "done", result: "failed" });
      expect(await states(payout)).toEqual({ execution: "failed", proposal: "failed", bill: "proposed" });
      expect(accountBalance(await ledgerOf(payout.circle.circleId), payableAccount(payout.circle.payees.amara))).toBe(26_400);
      expect((await entriesFor(payout)).map((entry) => entry.kind)).toEqual(["bill_approved"]);
      expect(await row(payout.circle.circleId, "select last_error from executions where id = $1", payout.executionId)).toEqual({ last_error: `paypal_${status.toLowerCase()}` });
    }
  });

  it("fails when PayPal refuses it", async () => {
    const payout = await venmoPayout();
    payout.pool.refuseNextPayout = "RECEIVER_UNREGISTERED";
    expect(await step(payout)).toEqual({ next: "done", result: "failed" });
    expect(await states(payout)).toEqual({ execution: "failed", proposal: "failed", bill: "proposed" });
  });

  it("is never sent in another currency than USD: it fails with a reason, and nothing reaches PayPal", async () => {
    const payout = await venmoPayout();
    // The fixtures' circles are all in USD, so the pool is asked for the same payout in euros: the adapter's refusal is what the worker must handle.
    const inEuros: PayoutDeps = { ...payout.deps, pool: { ...payout.pool, createPayout: (request, key) => payout.pool.createPayout({ ...request, amount: { ...request.amount, currency: "EUR" } }, key) } };
    expect(await executePayout(inEuros, payout.circle.circleId, payout.executionId)).toEqual({ next: "done", result: "failed" });
    expect(payout.pool.payouts.size).toBe(0);
    expect(payout.pool.requestIds).toEqual([]);
    expect(await states(payout)).toEqual({ execution: "failed", proposal: "failed", bill: "proposed" });
    expect(await row(payout.circle.circleId, "select last_error from executions where id = $1", payout.executionId)).toEqual({ last_error: "not_sent_venmo_usd_only" });
  });

  it("is never sent to an address Venmo cannot take: it fails with a reason, and the reason names no address", async () => {
    const payout = await venmoPayout({ receiver: "not-a-venmo-address" });
    expect(await step(payout)).toEqual({ next: "done", result: "failed" });
    expect(payout.pool.requestIds).toEqual([]);
    const failure = await row(payout.circle.circleId, "select last_error from executions where id = $1", payout.executionId);
    expect(failure).toEqual({ last_error: "not_sent_invalid_receiver" });
  });

  it("sends nothing twice when a step is repeated after a lost answer or an outage, and always with the same key", async () => {
    const lost = await venmoPayout();
    lost.pool.loseNextReply = "createPayout";
    expect(await step(lost)).toMatchObject({ next: "later", result: "unknown" });
    expect(await step(lost)).toEqual({ next: "done", result: "confirmed" });
    expect(lost.pool.payouts.size).toBe(1);
    expect(new Set(lost.pool.requestIds)).toEqual(new Set([`kin-payout-${lost.proposalId}`]));
    expect([...lost.pool.payouts.values()].map((made) => made.request.wallet)).toEqual(["VENMO"]);

    const outage = await venmoPayout();
    outage.pool.failNext = "createPayout";
    expect(await step(outage)).toMatchObject({ result: "unknown" });
    expect(await step(outage)).toEqual({ next: "done", result: "confirmed" });
    expect(outage.pool.payouts.size).toBe(1);
    // A step after the end repeats nothing.
    expect(await step(outage)).toEqual({ next: "done", result: "gone" });
    expect(outage.pool.payouts.size).toBe(1);
    expect((await entriesFor(outage)).map((entry) => entry.kind)).toEqual(["bill_approved", "payout_confirmed"]);
  });

  it("refuses a read-back that says the item went to another wallet", async () => {
    const payout = await venmoPayout();
    payout.pool.payoutStatus = "PENDING";
    await step(payout);
    const [stored] = [...payout.pool.payouts.values()];
    const item = stored?.batch.items[0];
    if (!stored || !item) throw new Error("No payout was made");
    stored.batch = { ...stored.batch, items: [{ ...item, wallet: "PAYPAL" }] };
    await expect(step(payout)).rejects.toThrow(/does not match/);
    expect((await states(payout)).execution).toBe("pending_at_paypal");
  });

  it("pays a PayPal wallet payout exactly as before: the request names no wallet", async () => {
    const payout = await approvedPayout({ real: true });
    expect(await walletOfExecution(payout)).toBe("paypal");
    await step(payout);
    expect([...payout.pool.payouts.values()].map((made) => "wallet" in made.request)).toEqual([false]);
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
