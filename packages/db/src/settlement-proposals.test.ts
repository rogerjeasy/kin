import { planApprovals, planSettlementPayouts, rosesMonth, settlePeriod } from "@kin/domain";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { CaregiverBillingError } from "./caregiver-billing.ts";
import { NothingToSettleError, SettlementExistsError, proposeSettlement, setOwnSettlementReceiver } from "./settlement-proposals.ts";
import { asPerson } from "./scope.ts";
import { seatPerson, serviceRows, snapshotFor, testDatabases, visitorWithCircle, type VisitorCircle } from "./testing/index.ts";

const db = testDatabases();
const NOW = new Date("2026-10-30T18:00:00Z");
const FEE = 25;
const PERIOD = "2026-10";
const payoutFee = () => FEE;

/** Rose's circle with its demo settlement set aside, so an organizer can put the month to the family themselves. */
async function circleToSettle(): Promise<{ circle: VisitorCircle; marcus: string; daniel: string }> {
  const circle = await visitorWithCircle(db);
  const [marcus, daniel] = await Promise.all([seatPerson(db, circle.circleId, circle.members.marcus), seatPerson(db, circle.circleId, circle.members.daniel)]);
  await serviceRows(db, circle.circleId, "update settlements set state = 'superseded' where circle_id = $1", [circle.circleId]);
  await serviceRows(db, circle.circleId, "update proposals set state = 'cancelled' where kind = 'member_payout' and circle_id = $1", [circle.circleId]);
  return { circle, marcus, daniel };
}

const propose = (userId: string, circleId: string) => asPerson(db.app, userId, (tx) => proposeSettlement(tx, { circleId, period: PERIOD, now: NOW, payoutFee }));
const proposals = (circleId: string) =>
  serviceRows(db, circleId, "select member_id, cents, state, purpose, settlement_id, plan from proposals where kind = 'member_payout' and state = 'pending_approval' order by cents desc");

describe("putting the month's settlement to the family", () => {
  it("raises one payout proposal for each member owed money, planned by the approval engine and bounded by the cash that arrived", async () => {
    const { circle } = await circleToSettle();
    const settlementId = await propose(circle.userId, circle.circleId);

    const expected = settlePeriod({ ...rosesMonth, payoutFee });
    const rows = await proposals(circle.circleId);
    const byPersona = new Map(Object.entries(circle.members).map(([persona, id]) => [id, persona]));
    expect(rows.map((row) => [byPersona.get(String(row.member_id)), Number(row.cents)]).toSorted()).toEqual(
      expected.plan.payouts.map((payout) => [payout.memberId, payout.releasableCents] as const).toSorted(),
    );
    for (const row of rows) {
      expect(row).toMatchObject({ state: "pending_approval", purpose: "settlement", settlement_id: settlementId });
      expect(row.plan).toMatchObject({ outcome: "needs_approval", payeeMemberId: row.member_id, announceToCircle: false });
    }
    const stored = (await snapshotFor(db, circle.userId, circle.circleId)).settlements.find((each) => each.id === settlementId);
    expect(stored).toMatchObject({ period: PERIOD, state: "proposed", agreementVersion: 1 });
  });

  it("is put once for a period: a second try, from any organizer's retry, is refused and nothing doubles", async () => {
    const { circle } = await circleToSettle();
    await propose(circle.userId, circle.circleId);
    await expect(propose(circle.userId, circle.circleId)).rejects.toBeInstanceOf(SettlementExistsError);
    expect(await proposals(circle.circleId)).toHaveLength(settlePeriod(rosesMonth).plan.payouts.length);
  });

  it("is refused to every role but the organizer, and while the circle is paused", async () => {
    const { circle, marcus, daniel } = await circleToSettle();
    await expect(propose(marcus, circle.circleId)).rejects.toMatchObject({ reason: "refused" });
    await expect(propose(daniel, circle.circleId)).rejects.toMatchObject({ reason: "refused" });
    await serviceRows(db, circle.circleId, "update circles set paused_until = $1, paused_by = $2 where id = $3", [new Date("2026-10-31T18:00:00Z"), circle.members.marcus, circle.circleId]);
    await expect(propose(circle.userId, circle.circleId)).rejects.toBeInstanceOf(Error);
    expect(await proposals(circle.circleId)).toEqual([]);
  });

  it("has nothing to put when the period holds no one's money: a month nobody has contributed to", async () => {
    const { circle } = await circleToSettle();
    await expect(asPerson(db.app, circle.userId, (tx) => proposeSettlement(tx, { circleId: circle.circleId, period: "2025-01", now: NOW, payoutFee }))).rejects.toBeInstanceOf(NothingToSettleError);
  });

  it("refuses a plan the agreement does not allow, or one that promises more than the pool holds, whatever the web app sent", async () => {
    const { circle } = await circleToSettle();
    const snapshot = await snapshotFor(db, circle.userId, circle.circleId);
    const settlement = settlePeriod({ ledger: snapshot.ledger, agreement: snapshot.agreement ?? rosesMonth.agreement, period: PERIOD, payoutFee });
    const roles = new Map(snapshot.members.map((member) => [member.id, member.role]));
    const planned = planSettlementPayouts({ settlement, roles, agreement: snapshot.agreement ?? rosesMonth.agreement, parentLevel: "decides", pausedUntil: null, now: NOW });
    const call = (payouts: unknown) =>
      asPerson(db.app, circle.userId, (tx) =>
        tx.execute(sql`select kin_private.propose_settlement(${circle.circleId}::uuid, ${PERIOD}, 1, ${JSON.stringify(settlement.inputs)}::jsonb, ${JSON.stringify(settlement.fairness)}::jsonb, ${JSON.stringify(settlement.plan)}::jsonb, ${JSON.stringify(payouts)}::jsonb)`),
      );

    // What PostgreSQL itself said, which the driver wraps in the query's own text.
    const refusal = async (payouts: unknown): Promise<string> => {
      const error: unknown = await call(payouts).then(() => null, (reason: unknown) => reason);
      if (error === null) throw new Error("The database accepted what it should have refused");
      return String((error as { cause?: Error }).cause?.message ?? error);
    };

    // Fewer approvals than the agreement asks for.
    const first = planned[0];
    if (!first) throw new Error("Rose's month pays someone");
    expect(await refusal([{ ...first, plan: { ...first.plan, slots: [] } }])).toMatch(/approval plan does not match/);
    // A payout above everything the pool may pay.
    expect(await refusal([{ ...first, cents: 9_000_000 }])).toMatch(/ceiling|more than the pool holds/);
    // One cent more than the pool holds, with a plan the agreement fully accepts: the cash is the bound.
    const cash = Number((await serviceRows(db, circle.circleId, "select coalesce(sum(case l.direction when 'debit' then l.cents else -l.cents end), 0) as cash from ledger_lines l join ledger_accounts a on a.id = l.account_id where a.code = 'pool_cash'"))[0]?.cash);
    const beyondCash = planApprovals({
      kind: "member_payout",
      cents: cash + 1,
      payee: { status: "approved", member: { memberId: first.memberId, role: "contributor" }, autoPay: null },
      agreement: snapshot.agreement ?? rosesMonth.agreement,
      parentLevel: "decides",
      pausedUntil: null,
      now: NOW,
    });
    expect(beyondCash.outcome).toBe("needs_approval");
    expect(await refusal([{ memberId: first.memberId, cents: cash + 1, plan: beyondCash }])).toMatch(/more than the pool holds/);
    // A member who does not share the cost: the caregiver.
    expect(await refusal([{ ...first, memberId: circle.members.amara, plan: { ...first.plan, payeeMemberId: circle.members.amara } }])).toMatch(/only a member who shares the cost/);
    // The same member twice.
    expect(await refusal([first, first])).toMatch(/invalid settlement payout/);
    expect(await proposals(circle.circleId)).toEqual([]);
    expect((await snapshotFor(db, circle.userId, circle.circleId)).settlements.filter((each) => each.state !== "superseded")).toEqual([]);
  });
});

describe("a member's settlement address", () => {
  it("is recorded by the member alone, shown masked, and held while a payout to them waits", async () => {
    const { circle } = await circleToSettle();
    const elena = circle.userId;
    await asPerson(db.app, elena, (tx) => setOwnSettlementReceiver(tx, { circleId: circle.circleId, email: " Elena@Personal.example.com " }));
    const snapshot = await snapshotFor(db, elena, circle.circleId);
    expect(snapshot.settlementReceivers).toEqual([{ memberId: circle.members.elena, receiver: "e••••@personal.example.com" }]);
    // It is a payee row of its own, never among the circle's billers.
    expect(snapshot.payees.map((payee) => payee.category)).not.toContain("settlement");

    await expect(asPerson(db.app, elena, (tx) => setOwnSettlementReceiver(tx, { circleId: circle.circleId, email: "not an address" }))).rejects.toMatchObject({ reason: "receiver" });

    await propose(elena, circle.circleId);
    await expect(asPerson(db.app, elena, (tx) => setOwnSettlementReceiver(tx, { circleId: circle.circleId, email: "other@personal.example.com" }))).rejects.toMatchObject({ reason: "payment_in_progress" });
    // Saying the same address again changes nothing and is not refused.
    await asPerson(db.app, elena, (tx) => setOwnSettlementReceiver(tx, { circleId: circle.circleId, email: "elena@personal.example.com" }));
  });

  it("is refused to a caregiver and an observer, who are never paid by a settlement", async () => {
    const { circle, daniel } = await circleToSettle();
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    for (const userId of [daniel, amara]) {
      await expect(asPerson(db.app, userId, (tx) => setOwnSettlementReceiver(tx, { circleId: circle.circleId, email: "x@personal.example.com" }))).rejects.toBeInstanceOf(CaregiverBillingError);
    }
  });
});
