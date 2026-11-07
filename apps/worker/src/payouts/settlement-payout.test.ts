import {
  PAYOUT_TOPIC,
  answerProposal,
  asPerson,
  asService,
  beginPayout,
  claimOutbox,
  proposeSettlement,
  readLedger,
  readPayoutJob,
  setOwnSettlementReceiver,
} from "@kin/db";
import { seatPerson, serviceRows, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { accountBalance, cashAvailableForPayouts, memberAccount } from "@kin/domain";
import { fakePool, type FakePool } from "@kin/paypal/testing";
import { describe, expect, it } from "vitest";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

import { executePayout, type PayoutDeps } from "./execute-payout.ts";
import { runPayoutBatch } from "./run-payouts.ts";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");
const FEE = 25;
const silent: InboxLog = () => {};
const PERSONAS = ["rose", "elena", "marcus", "ana"] as const;
type Persona = (typeof PERSONAS)[number];

type Settlement = {
  circle: VisitorCircle;
  users: Record<Persona, string>;
  pool: FakePool;
  deps: PayoutDeps;
  /** Each payout's execution, by the member paid. */
  executions: Map<string, string>;
  settlementId: string;
};

const ledgerOf = (circleId: string) => asService(db.service, circleId, (tx) => readLedger(tx, { id: circleId, currency: "USD" }));
const row = async (circleId: string, query: string, id: string) => (await serviceRows(db, circleId, query, [id]))[0];

/**
 * Rose's circle, where the month's settlement owes Elena 126.00 and Ana 40.00.
 * An organizer puts it to the family, and the family says yes until each payout
 * is approved. `fee` is what the worker reserves for PayPal's fee when it pays,
 * which the settlement was not planned with, so a payout can find the pool short.
 * `real` turns the circle into a real one first (test scaffolding:
 * no screen makes a real circle's agreement yet), so each yes carries step-up
 * evidence and the payout goes to the PayPal fake, to the address its member gave.
 */
async function approvedSettlement(options: { real?: boolean; addresses?: boolean; fee?: number } = {}): Promise<Settlement> {
  const circle = await visitorWithCircle(db);
  const users = {
    elena: circle.userId,
    rose: await seatPerson(db, circle.circleId, circle.members.rose),
    marcus: await seatPerson(db, circle.circleId, circle.members.marcus),
    ana: await seatPerson(db, circle.circleId, circle.members.ana),
  } satisfies Record<Persona, string>;
  // The demo's own settlement is set aside, so this one is put to the family the way a real circle's is.
  await serviceRows(db, circle.circleId, "update settlements set state = 'superseded' where circle_id = $1", [circle.circleId]);
  await serviceRows(db, circle.circleId, "update proposals set state = 'cancelled' where kind = 'member_payout' and circle_id = $1", [circle.circleId]);
  if (options.real && options.addresses !== false) {
    for (const persona of ["elena", "ana"] as const) {
      await asPerson(db.app, users[persona], (tx) => setOwnSettlementReceiver(tx, { circleId: circle.circleId, email: `${persona}@personal.example.com` }));
    }
  }
  const settlementId = await asPerson(db.app, users.elena, (tx) => proposeSettlement(tx, { circleId: circle.circleId, period: "2026-10", now: CLOCK, payoutFee: () => FEE }));
  if (options.real) await serviceRows(db, circle.circleId, "update circles set demo = false, clock_at = null where id = $1", [circle.circleId]);

  const proposals = await serviceRows(db, circle.circleId, "select id, member_id from proposals where settlement_id = $1 order by cents desc", [settlementId]);
  for (const proposal of proposals) {
    for (const persona of PERSONAS) {
      if (circle.members[persona] === proposal.member_id) continue;
      const state = (await row(circle.circleId, "select state from proposals where id = $1", String(proposal.id)))?.state;
      if (state !== "pending_approval") break;
      await asPerson(db.app, users[persona], (tx) =>
        answerProposal(tx, { circleId: circle.circleId, memberId: circle.members[persona], role: persona === "rose" ? "parent" : persona === "elena" ? "organizer" : "contributor" }, {
          proposalId: String(proposal.id),
          decision: "approve",
          method: "app",
          now: CLOCK,
          pausedUntil: null,
          evidenceRef: options.real ? `cognito:jti-${persona}:1793000000:pwd+otp+mfa` : null,
        }),
      );
    }
  }
  const pool = fakePool();
  const executions = new Map<string, string>();
  for (const proposal of proposals) {
    const execution = await row(circle.circleId, "select id from executions where proposal_id = $1", String(proposal.id));
    executions.set(String(proposal.member_id), String(execution?.id));
  }
  return { circle, users, pool, deps: { db: db.service, pool, now: () => CLOCK, feeReserve: () => options.fee ?? FEE }, executions, settlementId };
}

const execution = (settlement: Settlement, persona: Persona) => String(settlement.executions.get(settlement.circle.members[persona]));
const step = (settlement: Settlement, persona: Persona) => executePayout(settlement.deps, settlement.circle.circleId, execution(settlement, persona));
const settlementState = async (settlement: Settlement) => (await row(settlement.circle.circleId, "select state from settlements where id = $1", settlement.settlementId))?.state;
const settlementEntries = async (settlement: Settlement) => (await ledgerOf(settlement.circle.circleId)).entries.filter((entry) => entry.kind === "settlement_payout");

describe("an approved settlement payout", () => {
  it("is queued in the approval's own transaction: one execution and one outbox message for each member owed", async () => {
    const settlement = await approvedSettlement();
    expect([...settlement.executions.keys()].toSorted()).toEqual([settlement.circle.members.ana, settlement.circle.members.elena].toSorted());
    const messages = await serviceRows(db, settlement.circle.circleId, "select topic from outbox where topic = $1 and sent_at is null", [PAYOUT_TOPIC]);
    expect(messages).toHaveLength(2);
    expect(await settlementState(settlement)).toBe("approved");
    const keys = await serviceRows(db, settlement.circle.circleId, "select idempotency_key from executions order by idempotency_key");
    expect(keys.every((key) => String(key.idempotency_key).startsWith("kin-payout-"))).toBe(true);
  });

  it("is paid in a demo circle as a simulated settlement, labelled so, and the settlement closes once every payout is paid", async () => {
    const settlement = await approvedSettlement();
    const before = await ledgerOf(settlement.circle.circleId);
    expect(await step(settlement, "elena")).toEqual({ next: "done", result: "confirmed" });
    expect(await settlementState(settlement)).toBe("approved");
    expect(await step(settlement, "ana")).toEqual({ next: "done", result: "confirmed" });
    expect(await settlementState(settlement)).toBe("settled");

    expect(settlement.pool.payouts.size).toBe(0);
    const after = await ledgerOf(settlement.circle.circleId);
    const entries = await settlementEntries(settlement);
    expect(entries.map((entry) => [entry.simulated, entry.description])).toEqual([[true, "Settlement paid (simulated)"], [true, "Settlement paid (simulated)"]]);
    // Each member's balance with the pool is cleared by exactly what they were owed, and the fees are the circle's.
    expect(accountBalance(after, memberAccount(settlement.circle.members.elena)) - accountBalance(before, memberAccount(settlement.circle.members.elena))).toBe(-12_600);
    expect(accountBalance(after, memberAccount(settlement.circle.members.ana)) - accountBalance(before, memberAccount(settlement.circle.members.ana))).toBe(-4_000);
    expect(accountBalance(after, "pool_cash") - accountBalance(before, "pool_cash")).toBe(-(12_600 + 4_000 + 2 * FEE));
    expect(accountBalance(after, "fees") - accountBalance(before, "fees")).toBe(2 * FEE);
  });

  it("is paid once, however many times its message is handed out", async () => {
    const settlement = await approvedSettlement();
    // The batch leases whatever any circle has waiting, so it is drained until it finds nothing.
    while ((await runPayoutBatch(settlement.deps, silent)) > 0);
    expect(await settlementEntries(settlement)).toHaveLength(2);
    expect(await step(settlement, "elena")).toEqual({ next: "done", result: "gone" });
    expect(await step(settlement, "ana")).toEqual({ next: "done", result: "gone" });
    expect(await settlementEntries(settlement)).toHaveLength(2);
    // Other circles' payouts may still wait in the outbox; this circle's are all sent.
    const waiting = await claimOutbox(db.service, PAYOUT_TOPIC, 100, 60);
    expect(waiting.filter((message) => message.circleId === settlement.circle.circleId)).toEqual([]);
  });

  it("is paid in a real circle only once PayPal's record says the item succeeded, to the address its member gave", async () => {
    const settlement = await approvedSettlement({ real: true });
    const before = await ledgerOf(settlement.circle.circleId);
    expect(await step(settlement, "elena")).toEqual({ next: "done", result: "confirmed" });

    const [made] = [...settlement.pool.payouts.values()];
    expect(made?.request).toEqual({ senderBatchId: expect.stringMatching(/^kin-payout-/), receiver: "elena@personal.example.com", amount: { cents: 12_600, currency: "USD" }, note: expect.stringContaining("settled") });
    const after = await ledgerOf(settlement.circle.circleId);
    expect(accountBalance(after, "pool_cash") - accountBalance(before, "pool_cash")).toBe(-(12_600 + 25));
    const [entry] = await settlementEntries(settlement);
    expect(entry).toMatchObject({ simulated: false, source: { type: "paypal_event" }, description: "Settlement paid through PayPal" });
  });

  it("waits, recorded once, while a real member has not said where to send it, and pays once they do", async () => {
    const settlement = await approvedSettlement({ real: true, addresses: false });
    expect(await step(settlement, "elena")).toMatchObject({ next: "later", result: "held" });
    expect(await step(settlement, "elena")).toMatchObject({ next: "later", result: "held" });
    const held = await serviceRows(db, settlement.circle.circleId, "select details from audit_log where subject_id = $1 and action = 'payout.held'", [execution(settlement, "elena")]);
    expect(held).toEqual([{ details: { reason: "no_receiver" } }]);
    expect(settlement.pool.payouts.size).toBe(0);
    expect(await settlementEntries(settlement)).toEqual([]);

    await asPerson(db.app, settlement.users.elena, (tx) => setOwnSettlementReceiver(tx, { circleId: settlement.circle.circleId, email: "elena@personal.example.com" }));
    expect(await step(settlement, "elena")).toEqual({ next: "done", result: "confirmed" });
    expect([...settlement.pool.payouts.values()].map((made) => made.request.receiver)).toEqual(["elena@personal.example.com"]);
  });

  it("pays the address fixed when the family approved, whatever the member says later", async () => {
    const settlement = await approvedSettlement({ real: true });
    await serviceRows(db, settlement.circle.circleId, "update payees set paypal_receiver = $1 where member_id = $2 and category = 'settlement'", ["thief@example.com", settlement.circle.members.elena]);
    expect(await step(settlement, "elena")).toEqual({ next: "done", result: "confirmed" });
    expect([...settlement.pool.payouts.values()].map((made) => made.request.receiver)).toEqual(["elena@personal.example.com"]);
  });

  it("fails when PayPal returns the item, and the settlement stays open with the member still owed", async () => {
    const settlement = await approvedSettlement({ real: true });
    settlement.pool.payoutStatus = "RETURNED";
    expect(await step(settlement, "elena")).toEqual({ next: "done", result: "failed" });
    expect(await settlementEntries(settlement)).toEqual([]);
    expect(await settlementState(settlement)).toBe("approved");
    expect(await row(settlement.circle.circleId, "select state from proposals where id = (select proposal_id from executions where id = $1)", execution(settlement, "elena"))).toEqual({ state: "failed" });
  });

  it("never pays out money that has not arrived: it waits while the pool cannot cover the payout and its fee", async () => {
    const probe = await visitorWithCircle(db);
    const available = cashAvailableForPayouts(await ledgerOf(probe.circleId));
    const settlement = await approvedSettlement({ fee: available + 1 });
    expect(await step(settlement, "elena")).toMatchObject({ next: "later", result: "held" });
    expect(await settlementEntries(settlement)).toEqual([]);
    expect(settlement.pool.payouts.size).toBe(0);
  });

  it("counts a payout already readied against the pool, so two payouts cannot spend the same cash", async () => {
    const probe = await visitorWithCircle(db);
    const available = cashAvailableForPayouts(await ledgerOf(probe.circleId));
    // A fee that lets either payout alone through, but not both together.
    const fee = available - 12_600 - 4_000 + 1;
    expect(fee).toBeGreaterThanOrEqual(0);
    const settlement = await approvedSettlement({ real: true, fee });
    const begin = (persona: Persona) =>
      asService(db.service, settlement.circle.circleId, async (tx) => {
        const job = await readPayoutJob(tx, execution(settlement, persona), CLOCK);
        if (job === null) throw new Error("No payout job");
        return beginPayout(tx, job, fee);
      });
    expect(await begin("elena")).toBe("ready");
    expect(await begin("ana")).toBe("waiting_for_funds");
  });

  it("sends nothing while the circle is paused", async () => {
    const settlement = await approvedSettlement({ real: true });
    await serviceRows(db, settlement.circle.circleId, "update circles set paused_until = $1, paused_by = $2 where id = $3", [new Date("2026-11-01T18:00:00Z"), settlement.circle.members.marcus, settlement.circle.circleId]);
    expect(await step(settlement, "elena")).toMatchObject({ next: "later", result: "held" });
    expect(settlement.pool.payouts.size).toBe(0);
  });
});
