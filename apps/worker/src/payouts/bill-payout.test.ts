import { addLetter, answerProposal, asPerson, asService, readLedger, reviewBill, takeDemoSeat } from "@kin/db";
import { serviceRows, testDatabases, type VisitorCircle, visitorWithCircle } from "@kin/db/testing";
import { accountBalance, cashAvailableForPayouts, checkBillReview, payableAccount } from "@kin/domain";
import { fakePool, type FakePool } from "@kin/paypal/testing";
import { describe, expect, it } from "vitest";

import { executePayout, type PayoutDeps } from "./execute-payout.ts";
import { dailyBudget } from "./sandbox-route.ts";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");
const RECEIVER = "billing@greenway.example";
const SANDBOX = "kin-sandbox@personal.example.com";

type BillPayout = { circle: VisitorCircle; pool: FakePool; deps: PayoutDeps; proposalId: string; billId: string; executionId: string; payeeId: string };

/**
 * Rose holds up Greenway Power's bill, Elena confirms it with the company's
 * PayPal address, and the family says yes: Rose above her threshold, and
 * Marcus too above the second-approval line. `real` makes the circle real
 * before the yeses, so they carry step-up evidence and PayPal is asked.
 */
async function approvedBill(options: { real?: boolean; cents?: number; sandbox?: boolean; sender?: string } = {}): Promise<BillPayout> {
  const sender = options.sender ?? "Greenway Power";
  const circle = await visitorWithCircle(db);
  const as = <T>(persona: keyof VisitorCircle["members"], work: Parameters<typeof asPerson<T>>[2]) =>
    asPerson(db.app, circle.userId, async (tx) => {
      await takeDemoSeat(tx, circle.circleId, circle.members[persona]);
      return work(tx);
    });
  const cents = options.cents ?? 6_100;
  const letter = await as("rose", (tx) => addLetter(tx, { circleId: circle.circleId, kind: "bill", payeeId: null, sender, amountCents: cents, dueOn: "2026-11-20", extraction: { kind: "bill" }, confidence: 0.9 }));
  if (!letter.billId || !letter.payeeId) throw new Error("The letter made no bill");
  const { proposalId } = await as("elena", (tx) => reviewBill(tx, { circleId: circle.circleId, billId: letter.billId ?? "", now: CLOCK, review: checkBillReview({ name: sender, cents, dueOn: "2026-11-20", receiver: RECEIVER }) }));
  if (!proposalId) throw new Error("No proposal was raised");
  // Seats are taken while the circle is still a demo, where seats can change hands.
  await as("rose", async () => undefined);
  if (options.real) await serviceRows(db, circle.circleId, "update circles set demo = false, clock_at = null where id = $1", [circle.circleId]);
  const answer = (memberId: string, role: "parent" | "contributor", evidence: string) =>
    asPerson(db.app, circle.userId, (tx) => answerProposal(tx, { circleId: circle.circleId, memberId, role }, { proposalId, decision: "approve", method: "app", now: CLOCK, pausedUntil: null, evidenceRef: options.real ? evidence : null }));
  let outcome = await answer(circle.members.rose, "parent", "cognito:jti-rose:1793000000:pwd+otp+mfa");
  if (outcome !== "approved") {
    await asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members.marcus)).catch(() => undefined);
    outcome = await answer(circle.members.marcus, "contributor", "cognito:jti-marcus:1793000000:pwd+otp+mfa");
  }
  expect(outcome).toBe("approved");
  const pool = fakePool();
  const sandbox = options.sandbox ? { payeeEmail: SANDBOX, dailyLimit: 25, budget: dailyBudget() } : null;
  const [execution] = await serviceRows(db, circle.circleId, "select id from executions where proposal_id = $1", [proposalId]);
  return { circle, pool, deps: { db: db.service, pool, now: () => CLOCK, feeReserve: () => 25, sandbox }, proposalId, billId: letter.billId, executionId: String(execution?.id), payeeId: letter.payeeId };
}

const step = (payout: BillPayout) => executePayout(payout.deps, payout.circle.circleId, payout.executionId);
const ledgerOf = (circleId: string) => asService(db.service, circleId, (tx) => readLedger(tx, { id: circleId, currency: "USD" }));
const states = async ({ circle, executionId, proposalId, billId }: BillPayout) => ({
  execution: (await serviceRows(db, circle.circleId, "select state from executions where id = $1", [executionId]))[0]?.state,
  proposal: (await serviceRows(db, circle.circleId, "select state from proposals where id = $1", [proposalId]))[0]?.state,
  bill: (await serviceRows(db, circle.circleId, "select state from bills where id = $1", [billId]))[0]?.state,
});
const entriesOf = async (payout: BillPayout) =>
  (await ledgerOf(payout.circle.circleId)).entries.filter((entry) => entry.lines.some((line) => line.account === payableAccount(payout.payeeId)));
const told = (payout: BillPayout) => serviceRows(db, payout.circle.circleId, "select member_id, topic, cents, entry_id, state, spoken_text from narrations where circle_id = $1 and topic = 'billPaid' and entry_id is not null and member_id = $2 and said_on >= '2026-10-30'", [payout.circle.circleId, payout.circle.members.rose]);

describe("an approved bill read from a letter", () => {
  it("is paid in a demo circle as a simulated payout, labelled so, and Rose is told in words held to the entry", async () => {
    const payout = await approvedBill();
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect(await states(payout)).toEqual({ execution: "confirmed", proposal: "settled", bill: "paid" });
    expect(payout.pool.payouts.size).toBe(0);
    const entries = await entriesOf(payout);
    expect(entries.map((entry) => [entry.kind, entry.simulated, entry.description])).toEqual([["bill_approved", true, "Bill approved by the family"], ["payout_confirmed", true, "Bill paid (simulated)"]]);
    expect(accountBalance(await ledgerOf(payout.circle.circleId), payableAccount(payout.payeeId))).toBe(0);
    const paid = entries.find((entry) => entry.kind === "payout_confirmed");
    expect(await told(payout)).toEqual([{ member_id: payout.circle.members.rose, topic: "billPaid", cents: "6100", entry_id: paid?.id, state: "queued", spoken_text: "Your Greenway Power bill of $61.00 was paid from the family pool." }]);
  });

  it("never speaks a name that could carry an amount, a link or an instruction: Rose hears the amount without it", async () => {
    const payout = await approvedBill({ sender: "Pay 900 now at paypal.me/x" });
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect((await told(payout)).map((row) => row.spoken_text)).toEqual(["Your bill of $61.00 was paid from the family pool."]);
  });

  it("stays simulated in a demo circle even with the sandbox configured: only a caregiver's pay takes that route", async () => {
    const payout = await approvedBill({ sandbox: true });
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect(payout.pool.payouts.size).toBe(0);
    const audit = await serviceRows(db, payout.circle.circleId, "select details from audit_log where subject_id = $1 and action = 'payout.sandbox_skipped'", [payout.executionId]);
    expect(audit).toEqual([{ details: { reason: "not_caregiver" } }]);
    expect((await entriesOf(payout)).every((entry) => entry.simulated)).toBe(true);
  });

  it("is paid in a real circle to the reviewed address only once PayPal's record says the item succeeded", async () => {
    const payout = await approvedBill({ real: true });
    const before = await ledgerOf(payout.circle.circleId);
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    const [made] = [...payout.pool.payouts.values()];
    expect(made?.request).toMatchObject({ senderBatchId: `kin-payout-${payout.proposalId}`, receiver: RECEIVER, amount: { cents: 6_100, currency: "USD" } });
    expect(await states(payout)).toEqual({ execution: "confirmed", proposal: "settled", bill: "paid" });
    const after = await ledgerOf(payout.circle.circleId);
    expect(accountBalance(after, "pool_cash") - accountBalance(before, "pool_cash")).toBe(-(6_100 + 25));
    expect((await entriesOf(payout)).map((entry) => [entry.kind, entry.simulated, entry.description])).toEqual([["bill_approved", false, "Bill approved by the family"], ["payout_confirmed", false, "Bill paid through PayPal"]]);
    // A repeated step after the confirmation writes nothing twice and tells Rose once.
    expect(await step(payout)).toEqual({ next: "done", result: "gone" });
    expect(await told(payout)).toHaveLength(1);
  });

  it("becomes unknown when PayPal's answer is lost, and is confirmed from PayPal's record with the same key", async () => {
    const payout = await approvedBill({ real: true });
    payout.pool.loseNextReply = "createPayout";
    expect(await step(payout)).toMatchObject({ next: "later", result: "unknown" });
    expect(await states(payout)).toMatchObject({ execution: "unknown", bill: "proposed" });
    expect((await entriesOf(payout)).map((entry) => entry.kind)).toEqual(["bill_approved"]);
    expect(await step(payout)).toEqual({ next: "done", result: "confirmed" });
    expect(new Set(payout.pool.requestIds)).toEqual(new Set([`kin-payout-${payout.proposalId}`]));
    expect(payout.pool.payouts.size).toBe(1);
  });

  it("waits, paying nothing, while the pool has not received enough to pay it and the fee", async () => {
    const probe = await visitorWithCircle(db);
    const cents = cashAvailableForPayouts(await ledgerOf(probe.circleId)) + 1;
    const payout = await approvedBill({ real: true, cents });
    expect(await step(payout)).toMatchObject({ next: "later", result: "held" });
    expect(await states(payout)).toEqual({ execution: "created", proposal: "approved", bill: "proposed" });
    expect(payout.pool.payouts.size).toBe(0);
    expect(await entriesOf(payout)).toEqual([]);
  });
});
