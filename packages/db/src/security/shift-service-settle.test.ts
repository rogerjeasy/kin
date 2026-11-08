import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { checkInShift, checkOutShift, settleShift, settleShiftAsService } from "../shifts.ts";
import { asPerson, asService } from "../scope.ts";
import { addMember, seatPerson, visitorWithCircle, type VisitorCircle } from "../testing/index.ts";
import { testDatabases } from "../testing/databases.ts";
import { reasonOf } from "../testing/real-shifts.ts";
import { CLOCK, newShift } from "../testing/shifts.ts";
import { REFUSED, errorCode } from "../testing/sql.ts";

const db = testDatabases();

const person = <T>(userId: string, work: Parameters<typeof asPerson<T>>[2]) => asPerson(db.app, userId, work);
const reason = reasonOf;

async function confirmed(circle: VisitorCircle, amara: string, change: Parameters<typeof newShift>[2] = {}): Promise<string> {
  const circleId = circle.circleId;
  const shiftId = await newShift(db, circle, change);
  await person(amara, (tx) => checkInShift(tx, { circleId, shiftId }));
  await person(amara, (tx) => checkOutShift(tx, { circleId, shiftId, now: CLOCK }));
  // The family's word by the database's own operation, so the shift stays confirmed and unsettled.
  await person(circle.userId, (tx) => tx.execute(sql`select kin_private.confirm_shift(${circleId}::uuid, ${shiftId}::uuid)`));
  return shiftId;
}

/** Everything a settled shift leaves behind that is not who did it or when: the price, the plan, the approval, the payout it queued. */
async function outcome(circleId: string, shiftId: string) {
  const shift = await db.admin.execute<Record<string, unknown>>(sql`
    select s.state::text, s.cents::text, s.worked_minutes, s.billable_minutes, s.rate_cents_per_hour::text as rate, (s.permission_id is not null) as by_permission,
           p.state::text as proposal_state, p.kind::text as proposal_kind, p.cents::text as proposal_cents, p.purpose, p.plan - 'permissionId' as plan, (p.raised_by is null) as raised_by_nobody,
           (select count(*)::int from approvals a where a.proposal_id = p.id) as approvals,
           (select string_agg(distinct a.method::text, ',') from approvals a where a.proposal_id = p.id) as methods,
           (select count(*)::int from shift_permission_uses u where u.shift_id = s.id) as uses,
           (select count(*)::int from executions e where e.proposal_id = p.id) as executions,
           (select count(*)::int from outbox o where o.circle_id = s.circle_id and o.topic = 'payout.execute' and o.payload ->> 'executionId' in (select e.id::text from executions e where e.proposal_id = p.id)) as payouts
    from shifts s join proposals p on p.circle_id = s.circle_id and p.id = s.proposal_id
    where s.circle_id = ${circleId} and s.id = ${shiftId}`);
  return shift.rows[0];
}

describe("settling a shift as Kin's worker", () => {
  it("ends up exactly as a person's settling does: the same price, plan, approval and queued payout", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const circleId = circle.circleId;
    const byPerson = await confirmed(circle, amara, { endsAt: "2026-10-30T20:00:00Z" });
    const byWorker = await confirmed(circle, amara, { endsAt: "2026-10-30T20:00:00Z" });
    const a = await person(circle.userId, (tx) => settleShift(tx, { circleId, shiftId: byPerson }));
    const b = await asService(db.service, circleId, (tx) => settleShiftAsService(tx, { circleId, shiftId: byWorker }));
    expect(b).toMatchObject({ outcome: a.outcome, cents: a.cents, permissionId: a.permissionId });
    const [mine, theirs] = [await outcome(circleId, byPerson), await outcome(circleId, byWorker)];
    expect(theirs).toEqual(mine);
    expect(mine).toMatchObject({ state: "priced", cents: "4400", by_permission: true, approvals: 1, methods: "mandate", uses: 1, executions: 1, payouts: 1, raised_by_nobody: true });
    const audit = await db.admin.execute<{ actor: string; member_id: string | null; origin: string; shift: string }>(
      sql`select actor::text, member_id, origin, subject_id as shift from audit_log where action = 'shift.priced' and subject_id in (${byPerson}, ${byWorker}) order by sequence`,
    );
    expect(audit.rows).toEqual([
      { actor: "member", member_id: circle.members.elena, origin: "web", shift: byPerson },
      { actor: "service", member_id: null, origin: "worker", shift: byWorker },
    ]);
  });

  it("puts a shift outside every permission to the family, as for a person, and is idempotent", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const circleId = circle.circleId;
    await db.admin.execute(sql`update shift_permissions set status = 'revoked', ended_at = now() where circle_id = ${circleId}`);
    const shiftId = await confirmed(circle, amara);
    const settled = await asService(db.service, circleId, (tx) => settleShiftAsService(tx, { circleId, shiftId }));
    expect(settled).toMatchObject({ outcome: "asks_family", permissionId: null });
    expect(await asService(db.service, circleId, (tx) => settleShiftAsService(tx, { circleId, shiftId }))).toMatchObject({ proposalId: settled.proposalId });
    expect((await db.admin.execute(sql`select 1 from proposals where purpose = 'shift' and circle_id = ${circleId} and state = 'pending_approval'`)).rows.length).toBeGreaterThan(0);
  });

  it("keeps every check: a shift without both keys, a cancelled one, a paused circle and the wrong circle are refused", async () => {
    const circle = await visitorWithCircle(db);
    const other = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const circleId = circle.circleId;
    const settle = (id = circleId, shiftId: string) => reason(asService(db.service, circleId, (tx) => settleShiftAsService(tx, { circleId: id, shiftId })));
    const open = await newShift(db, circle);
    await person(amara, (tx) => checkInShift(tx, { circleId, shiftId: open }));
    expect(await settle(circleId, open)).toBe("keys_missing");
    expect(await errorCode(asService(db.service, circleId, (tx) => tx.execute(sql`select kin_private.pay_shift(${circleId}::uuid, ${open}::uuid, '{}'::jsonb)`)))).toBe("KS009");
    const ready = await confirmed(circle, amara);
    expect(await settle(other.circleId, ready)).toBe("refused");
    expect(await errorCode(asService(db.service, circleId, (tx) => tx.execute(sql`select kin_private.pay_shift(${other.circleId}::uuid, ${ready}::uuid, '{}'::jsonb)`)))).toBe(REFUSED.permission);
    expect(await errorCode(asService(db.service, circleId, (tx) => tx.execute(sql`select kin_private.shift_payment_facts(${other.circleId}::uuid, ${ready}::uuid)`)))).toBe(REFUSED.permission);
    expect(await errorCode(db.service.transaction((tx) => tx.execute(sql`select kin_private.pay_shift(${circleId}::uuid, ${ready}::uuid, '{}'::jsonb)`)))).toBe(REFUSED.permission);
    await db.admin.execute(sql`update circles set paused_until = ${new Date(CLOCK.getTime() + 3_600_000).toISOString()}, paused_by = ${circle.members.elena} where id = ${circleId}`);
    expect(await settle(circleId, ready)).toBe("paused");
    expect((await db.admin.execute(sql`select 1 from shifts where id = ${ready} and state = 'confirmed' and proposal_id is null`)).rows).toHaveLength(1);
  });

  it("loosens nothing for a person: an observer and a stranger are still refused, and a caregiver settles only their own shift", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const daniel = await seatPerson(db, circle.circleId, circle.members.daniel);
    const other = await addMember(db, circle.circleId, "caregiver");
    const stranger = await visitorWithCircle(db);
    const circleId = circle.circleId;
    const shiftId = await confirmed(circle, amara);
    for (const userId of [daniel, other.userId, stranger.userId]) {
      expect(await reason(person(userId, (tx) => settleShift(tx, { circleId, shiftId })))).toBe("refused");
      expect(await errorCode(person(userId, (tx) => tx.execute(sql`select kin_private.shift_payment_facts(${circleId}::uuid, ${shiftId}::uuid)`)))).toBe(REFUSED.permission);
    }
    expect(await reason(person(amara, (tx) => settleShift(tx, { circleId, shiftId })))).toBe("no error");
  });
});
