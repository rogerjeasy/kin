import { answerPursePayment, asPerson, asService, cancelPursePayment, proposePursePayment, readLedger, readPursePayees, removePursePayee, type ProposePursePaymentInput } from "@kin/db";
import { adminRun, seatPerson, serviceRows, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { FEES, POOL_CASH, PURSE_CASH, accountBalance } from "@kin/domain";
import { fakePool, type FakePool } from "@kin/paypal/testing";
import { describe, expect, it } from "vitest";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

import { reconcilePurse, runPurseBatch, runPurseTurn, type PurseDeps } from "./run-purse.ts";

const db = testDatabases();
const FEE = 25;
const silent: InboxLog = () => {};

type Setup = { circle: VisitorCircle; rose: string; lily: string; pool: FakePool; deps: PurseDeps };

/**
 * Rose's demo circle with Rose seated. `real` turns it into a real circle
 * (test scaffolding only), so its payments go to the PayPal fake and the
 * circle runs on the real clock.
 */
async function setup(options: { real?: boolean } = {}): Promise<Setup> {
  const circle = await visitorWithCircle(db);
  const rose = await seatPerson(db, circle.circleId, circle.members.rose);
  if (options.real) await serviceRows(db, circle.circleId, "update circles set demo = false, clock_at = null where id = $1", [circle.circleId]);
  const payees = await asPerson(db.app, rose, (tx) => readPursePayees(tx, circle.circleId));
  const lily = payees.find((payee) => payee.name === "Lily")?.id;
  if (!lily) throw new Error("No Lily in the demo's address book");
  const pool = fakePool();
  pool.payoutFeeCents = FEE;
  const now = options.real ? () => new Date() : () => new Date("2026-10-30T18:00:00Z");
  return { circle, rose, lily, pool, deps: { db: db.service, pool, now, feeReserve: () => FEE } };
}

function ask(s: Setup, change: Partial<ProposePursePaymentInput> = {}): Promise<string> {
  return asPerson(db.app, s.rose, async (tx) =>
    (
      await proposePursePayment(tx, {
        circleId: s.circle.circleId,
        payeeId: s.lily,
        payeeName: "Lily",
        cents: 2_500,
        memo: "for her birthday",
        words: "Send Lily 25 dollars for her birthday.",
        route: "paypal",
        markers: [],
        holdReasons: [],
        readBack: "Send Lily $25.00 for her birthday, from your Purse?",
        readBackSource: "template",
        ...change,
      })
    ).id,
  );
}

const yes = (s: Setup, paymentId: string) => asPerson(db.app, s.rose, (tx) => answerPursePayment(tx, { circleId: s.circle.circleId, paymentId, answer: "yes", method: "voice", evidence: "Yes, please." }));
const ledger = (s: Setup) => asService(db.service, s.circle.circleId, (tx) => readLedger(tx, { id: s.circle.circleId, currency: "USD" }));
const stateOf = async (s: Setup, paymentId: string) => (await serviceRows(db, s.circle.circleId, "select state, last_error from purse_payments where id = $1", [paymentId]))[0];

describe("the Purse in a demo circle", () => {
  it("pays a gift on her yes alone, simulated, with a ledger entry that names no payee", async () => {
    const s = await setup();
    const gift = await ask(s);
    expect(await yes(s, gift)).toBe("approved");
    expect(await runPurseTurn(s.deps, s.circle.circleId)).toMatchObject({ paid: 1, funded: 0 });
    expect(await stateOf(s, gift)).toMatchObject({ state: "paid" });
    const after = await ledger(s);
    const paid = after.entries.filter((entry) => entry.kind === "purse_paid");
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ simulated: true, description: "Paid from the parent's Purse (simulated)" });
    expect(paid[0]?.lines.map((line) => line.account).toSorted()).toEqual(["expense:purse", "purse_cash"]);
    expect(accountBalance(after, PURSE_CASH)).toBe(2_500);
    expect(s.pool.payouts.size).toBe(0);
    // A second turn finds nothing to do, and pays nothing twice.
    expect(await runPurseTurn(s.deps, s.circle.circleId)).toEqual({ funded: 0, expired: 0, released: 0, lapsed: 0, paid: 0, failed: 0, waiting: 0 });
    expect((await ledger(s)).entries.filter((entry) => entry.kind === "purse_paid")).toHaveLength(1);
  });

  it("lets a held payment go once its cooling-off ends, and lets one to a new payee lapse", async () => {
    const s = await setup();
    const aboveCap = await ask(s, { cents: 4_500, holdReasons: ["above_cap"] });
    const stranger = await ask(s, { payeeId: null, payeeName: "the man from the bank", cents: 50_000, holdReasons: ["new_payee", "risky_route", "above_cap"], route: "gift_card", markers: ["gift_cards"] });
    expect(await yes(s, aboveCap)).toBe("held");
    expect(await yes(s, stranger)).toBe("held");
    expect(await runPurseTurn(s.deps, s.circle.circleId)).toMatchObject({ released: 0, lapsed: 0, paid: 0 });
    await adminRun(db, "update circles set clock_at = clock_at + interval '25 hours' where id = $1", [s.circle.circleId]);
    expect(await runPurseTurn(s.deps, s.circle.circleId)).toMatchObject({ released: 1, lapsed: 1, paid: 1 });
    expect(await stateOf(s, aboveCap)).toMatchObject({ state: "paid" });
    expect(await stateOf(s, stranger)).toMatchObject({ state: "expired" });
    expect(accountBalance(await ledger(s), PURSE_CASH)).toBe(500);
  });

  it("never pays a held payment the family cancelled", async () => {
    const s = await setup();
    const held = await ask(s, { cents: 4_500, holdReasons: ["above_cap"] });
    expect(await yes(s, held)).toBe("held");
    await asPerson(db.app, s.circle.userId, (tx) => cancelPursePayment(tx, { circleId: s.circle.circleId, paymentId: held, pressured: false }));
    await adminRun(db, "update circles set clock_at = clock_at + interval '25 hours' where id = $1", [s.circle.circleId]);
    expect(await runPurseTurn(s.deps, s.circle.circleId)).toMatchObject({ released: 0, paid: 0 });
    expect(await stateOf(s, held)).toMatchObject({ state: "cancelled" });
    expect(accountBalance(await ledger(s), PURSE_CASH)).toBe(5_000);
  });

  it("waits while the circle is paused, and fails a payment whose payee was removed, leaving her money in the Purse", async () => {
    const s = await setup();
    const gift = await ask(s);
    expect(await yes(s, gift)).toBe("approved");
    await adminRun(db, "update circles set paused_until = clock_at + interval '1 day', paused_by = $2 where id = $1", [s.circle.circleId, s.circle.members.elena]);
    expect(await runPurseTurn(s.deps, s.circle.circleId)).toMatchObject({ paid: 0, waiting: 1 });
    await adminRun(db, "update circles set paused_until = null, paused_by = null where id = $1", [s.circle.circleId]);
    await asPerson(db.app, s.circle.userId, (tx) => removePursePayee(tx, s.circle.circleId, s.lily));
    expect(await runPurseTurn(s.deps, s.circle.circleId)).toMatchObject({ paid: 0, failed: 1 });
    expect(await stateOf(s, gift)).toMatchObject({ state: "failed", last_error: "payee_removed" });
    expect(accountBalance(await ledger(s), PURSE_CASH)).toBe(5_000);
  });

  it("tops the Purse up once a week, never past its ceiling", async () => {
    const s = await setup();
    const gift = await ask(s, { cents: 4_000 });
    await yes(s, gift);
    await runPurseTurn(s.deps, s.circle.circleId);
    expect(accountBalance(await ledger(s), PURSE_CASH)).toBe(1_000);
    await adminRun(db, "update circles set clock_at = clock_at + interval '7 days' where id = $1", [s.circle.circleId]);
    expect(await runPurseTurn(s.deps, s.circle.circleId)).toMatchObject({ funded: 5_000 });
    expect(await runPurseTurn(s.deps, s.circle.circleId)).toMatchObject({ funded: 0 });
    await adminRun(db, "update circles set clock_at = clock_at + interval '7 days' where id = $1", [s.circle.circleId]);
    // Sixty in the Purse, a hundred the most it holds: forty more, not fifty.
    expect(await runPurseTurn(s.deps, s.circle.circleId)).toMatchObject({ funded: 4_000 });
    const after = await ledger(s);
    expect(accountBalance(after, PURSE_CASH)).toBe(10_000);
    expect(after.entries.filter((entry) => entry.kind === "purse_funded").every((entry) => entry.simulated)).toBe(true);
  });
});

describe("the Purse in a real circle", () => {
  it("pays through PayPal with the payment's own key, and records it only once PayPal's record says so", async () => {
    const s = await setup({ real: true });
    // A real circle on the real clock: this week's float has not moved yet, so the first turn tops it up to the ceiling.
    await runPurseTurn(s.deps, s.circle.circleId);
    const before = await ledger(s);
    const gift = await ask(s);
    expect(await yes(s, gift)).toBe("approved");
    s.pool.payoutStatus = "PENDING";
    expect(await runPurseTurn(s.deps, s.circle.circleId)).toMatchObject({ paid: 0, waiting: 1 });
    expect(await stateOf(s, gift)).toMatchObject({ state: "executing" });
    const [batchId] = [...s.pool.payouts.keys()];
    expect([...s.pool.payouts.values()].map((payout) => payout.request.senderBatchId)).toEqual([`kin-purse-${gift}`]);
    s.pool.settlePayout(String(batchId), "SUCCESS");
    expect(await runPurseTurn(s.deps, s.circle.circleId)).toMatchObject({ paid: 1 });
    const after = await ledger(s);
    expect(accountBalance(after, PURSE_CASH)).toBe(accountBalance(before, PURSE_CASH) - 2_500);
    expect(accountBalance(after, POOL_CASH)).toBe(accountBalance(before, POOL_CASH) - FEE);
    expect(accountBalance(after, FEES)).toBe(accountBalance(before, FEES) + FEE);
    expect(after.entries.filter((entry) => entry.kind === "purse_paid").map((entry) => entry.simulated)).toEqual([false]);
    expect(s.pool.requestIds.filter((id) => id === `kin-purse-${gift}`)).toHaveLength(1);
  });

  it("asks again with the same key when PayPal's answer is lost, and pays once", async () => {
    const s = await setup({ real: true });
    await runPurseTurn(s.deps, s.circle.circleId);
    const gift = await ask(s);
    await yes(s, gift);
    s.pool.loseNextReply = "createPayout";
    expect(await runPurseTurn(s.deps, s.circle.circleId)).toMatchObject({ paid: 0 });
    expect(await stateOf(s, gift)).toMatchObject({ state: "unknown" });
    expect(await runPurseTurn(s.deps, s.circle.circleId)).toMatchObject({ paid: 1 });
    expect(s.pool.payouts.size).toBe(1);
    expect((await ledger(s)).entries.filter((entry) => entry.kind === "purse_paid")).toHaveLength(1);
  });

  it("fails a payment PayPal refuses, and leaves her money in the Purse", async () => {
    const s = await setup({ real: true });
    await runPurseTurn(s.deps, s.circle.circleId);
    const before = accountBalance(await ledger(s), PURSE_CASH);
    const gift = await ask(s);
    await yes(s, gift);
    s.pool.refuseNextPayout = "RECEIVER_UNREGISTERED";
    expect(await runPurseTurn(s.deps, s.circle.circleId)).toMatchObject({ paid: 0, failed: 1 });
    expect(await stateOf(s, gift)).toMatchObject({ state: "failed" });
    expect(accountBalance(await ledger(s), PURSE_CASH)).toBe(before);
  });

  it("reconciles a paid payment against PayPal's Transaction Search, and records a record that disagrees", async () => {
    const s = await setup({ real: true });
    await runPurseTurn(s.deps, s.circle.circleId);
    const [one, two] = [await ask(s), await ask(s, { cents: 1_000 })];
    await yes(s, String(one));
    await yes(s, String(two));
    await runPurseTurn(s.deps, s.circle.circleId);
    const items = await serviceRows(db, s.circle.circleId, "select id, paypal_item_id from purse_payments where state = 'paid' order by cents desc", []);
    const later = { ...s.deps, now: () => new Date(Date.now() + 4 * 60 * 60 * 1000) };
    const record = (cents: number) => ({ transactionId: "TX1", status: "S", eventCode: "T0000", amountCents: -cents, currency: "USD", initiatedAt: "", feeCents: FEE, counterpartyEmailMasked: null, counterpartyAccountId: null });
    s.pool.payoutTransactions.set(String(items[0]?.paypal_item_id), record(2_500));
    s.pool.payoutTransactions.set(String(items[1]?.paypal_item_id), record(9_999));
    expect(await reconcilePurse(later, silent)).toMatchObject({ reconciled: 1, mismatched: 1 });
    const mismatches = await serviceRows(db, s.circle.circleId, "select subject_id from audit_log where action = 'purse.reconcile_mismatch'", []);
    expect(mismatches.map((row) => row.subject_id)).toEqual([items[1]?.id]);
    // Too soon after paying, nothing is looked for: Transaction Search lags by hours.
    expect(await reconcilePurse(s.deps, silent)).toMatchObject({ reconciled: 0 });
  });

  it("is found by the worker's batch among every circle with Purse work", async () => {
    const s = await setup();
    const gift = await ask(s);
    await yes(s, gift);
    expect(await runPurseBatch(s.deps, silent)).toBeGreaterThanOrEqual(1);
    expect(await stateOf(s, gift)).toMatchObject({ state: "paid" });
  });
});
