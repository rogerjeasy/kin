import { SHIFT_STATES, SHIFT_TRANSITIONS, type ShiftState } from "@kin/domain";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { grantShiftPermission, setShiftPermissionStatus } from "../shift-permissions.ts";
import { cancelShift, checkInShift, checkOutShift, confirmShift, scheduleShift, setOwnPayoutTarget, setShiftRules, settleShift } from "../shifts.ts";
import { asPerson, asService } from "../scope.ts";
import { addMember, seatPerson, snapshotFor, visitorWithCircle, type VisitorCircle } from "../testing/index.ts";
import { testDatabases } from "../testing/databases.ts";
import { CLOCK, deepMessage, newShift } from "../testing/shifts.ts";
import { REFUSED, errorCode } from "../testing/sql.ts";

const db = testDatabases();

const person = <T>(userId: string, work: Parameters<typeof asPerson<T>>[2]) => asPerson(db.app, userId, work);
const reason = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
    return "no error";
  } catch (error) {
    return (error as { reason?: string }).reason ?? deepMessage(error);
  }
};
/** Raw SQL as a person, so the database itself is asked rather than the code that normally asks it. */
const raw = (userId: string, query: ReturnType<typeof sql>) => person(userId, (tx) => tx.execute(query));
const serviceSql = (circleId: string, query: ReturnType<typeof sql>) => asService(db.service, circleId, (tx) => tx.execute(query));

async function confirmedShift(circle: VisitorCircle, amara: string, change: Parameters<typeof newShift>[2] = {}): Promise<string> {
  const circleId = circle.circleId;
  const shiftId = await newShift(db, circle, change);
  await person(amara, (tx) => checkInShift(tx, { circleId, shiftId }));
  await person(amara, (tx) => checkOutShift(tx, { circleId, shiftId, now: CLOCK }));
  // Confirmed by the family, but not yet settled, by the database's own operation.
  await raw(circle.userId, sql`select kin_private.confirm_shift(${circleId}::uuid, ${shiftId}::uuid)`);
  return shiftId;
}

describe("who sees the calendar and the permissions", () => {
  it("shows a caregiver only the shifts they are on and none of the permissions, and everyone else the whole calendar", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const daniel = await seatPerson(db, circle.circleId, circle.members.daniel);
    const whole = await snapshotFor(db, circle.userId, circle.circleId);
    const hers = await snapshotFor(db, amara, circle.circleId);
    expect(whole.shifts.length).toBeGreaterThan(hers.shifts.length);
    expect(hers.shifts.length).toBeGreaterThan(0);
    expect(hers.shifts.every((shift) => shift.memberId === circle.members.amara)).toBe(true);
    expect(hers.shiftPermissions).toEqual([]);
    expect(hers.shiftRules).toHaveLength(1);
    // An observer reads it all and writes nothing.
    const observed = await snapshotFor(db, daniel, circle.circleId);
    expect(observed.shifts).toHaveLength(whole.shifts.length);
    expect(observed.shiftPermissions).toHaveLength(1);
    const shiftId = await newShift(db, circle);
    expect(await reason(person(daniel, (tx) => scheduleShift(tx, { circleId: circle.circleId, id: randomUUID(), kind: "visit", memberId: circle.members.ana, title: null, startsAt: new Date(CLOCK), endsAt: new Date(CLOCK.getTime() + 3_600_000) })))).toBe("refused");
    expect(await reason(person(daniel, (tx) => cancelShift(tx, { circleId: circle.circleId, shiftId })))).toBe("refused");
    expect(await reason(person(daniel, (tx) => confirmShift(tx, { circleId: circle.circleId, shiftId, now: CLOCK })))).toBe("refused");
    const ready = await confirmedShift(circle, amara);
    expect(await reason(person(daniel, (tx) => settleShift(tx, { circleId: circle.circleId, shiftId: ready })))).toBe("refused");
    expect(await errorCode(raw(daniel, sql`select kin_private.pay_shift(${circle.circleId}::uuid, ${ready}::uuid, '{}'::jsonb)`))).toBe(REFUSED.permission);
    expect(await reason(person(daniel, (tx) => setShiftRules(tx, { circleId: circle.circleId, payeeId: circle.payees.amara, minimumMinutes: 0, overtimeAfterMinutes: null, overtimePercent: 150 })))).toBe("refused");
  });

  it("lets another circle neither read nor write them", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    const shiftId = await newShift(db, theirs);
    const theirAmara = await seatPerson(db, theirs.circleId, theirs.members.amara);
    const read = async (table: string) => (await person(mine.userId, (tx) => tx.execute<{ n: string }>(sql`select count(*) as n from ${sql.identifier(table)} where circle_id = ${theirs.circleId}`))).rows[0]?.n;
    for (const table of ["shifts", "shift_permissions", "shift_permission_uses"]) expect(await read(table)).toBe("0");
    expect(await reason(person(mine.userId, (tx) => scheduleShift(tx, { circleId: theirs.circleId, id: randomUUID(), kind: "visit", memberId: theirs.members.ana, title: null, startsAt: CLOCK, endsAt: new Date(CLOCK.getTime() + 3_600_000) })))).toBe("refused");
    expect(await reason(person(mine.userId, (tx) => cancelShift(tx, { circleId: theirs.circleId, shiftId })))).toBe("refused");
    expect(await reason(person(mine.userId, (tx) => checkInShift(tx, { circleId: theirs.circleId, shiftId })))).toBe("refused");
    expect(await reason(person(mine.userId, (tx) => setShiftPermissionStatus(tx, { circleId: theirs.circleId, permissionId: randomUUID(), status: "paused" })))).toBe("refused");
    // Kin's service acting for my circle cannot reach theirs either.
    expect((await asService(db.service, mine.circleId, (tx) => tx.execute(sql`select id from shifts where circle_id = ${theirs.circleId}`))).rows).toEqual([]);
    expect(await errorCode(asService(db.service, mine.circleId, (tx) => tx.execute(sql`update shifts set state = 'cancelled' where id = ${shiftId}`)))).toBe("no error");
    expect((await db.admin.execute<{ state: string }>(sql`select state from shifts where id = ${shiftId}`)).rows).toEqual([{ state: "scheduled" }]);
    expect(theirAmara).toBeTruthy();
  });

  it("gives no role a direct write to the tables, and the service only the state column", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const shiftId = await newShift(db, circle);
    for (const userId of [circle.userId, amara]) {
      expect(await errorCode(raw(userId, sql`update shifts set state = 'cancelled' where id = ${shiftId}`))).toBe(REFUSED.permission);
      expect(await errorCode(raw(userId, sql`delete from shifts where id = ${shiftId}`))).toBe(REFUSED.permission);
      expect(await errorCode(raw(userId, sql`insert into shifts (id, circle_id, kind, member_id, starts_at, ends_at, created_by) values (gen_random_uuid(), ${circle.circleId}, 'visit', ${circle.members.ana}, now(), now() + interval '1 hour', ${circle.members.elena})`))).toBe(REFUSED.permission);
      expect(await errorCode(raw(userId, sql`update shift_permissions set per_shift_cents = 1`))).toBe(REFUSED.permission);
      expect(await errorCode(raw(userId, sql`insert into shift_permission_uses (id, circle_id, permission_id, shift_id, proposal_id, cents, minutes, day) values (gen_random_uuid(), ${circle.circleId}, gen_random_uuid(), ${shiftId}, gen_random_uuid(), 1, 1, '2026-10-30')`))).toBe(REFUSED.permission);
      expect(await errorCode(raw(userId, sql`delete from shift_permission_uses`))).toBe(REFUSED.permission);
    }
    // The worker may move the state column and nothing else.
    expect(await errorCode(serviceSql(circle.circleId, sql`update shifts set checked_in_at = now() where id = ${shiftId}`))).toBe(REFUSED.permission);
    expect(await errorCode(serviceSql(circle.circleId, sql`update shift_permissions set status = 'revoked', ended_at = now()`))).toBe(REFUSED.permission);
    expect(await errorCode(serviceSql(circle.circleId, sql`delete from shifts where id = ${shiftId}`))).toBe(REFUSED.permission);
  });
});

describe("the two keys", () => {
  it("never let a caregiver confirm their own shift or another's, and let a sibling confirm only where no parent decides", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const marcus = await seatPerson(db, circle.circleId, circle.members.marcus);
    const ana = await seatPerson(db, circle.circleId, circle.members.ana);
    const circleId = circle.circleId;
    const shiftId = await newShift(db, circle);
    await person(amara, (tx) => checkInShift(tx, { circleId, shiftId }));
    expect(await reason(person(amara, (tx) => confirmShift(tx, { circleId, shiftId, now: CLOCK })))).toBe("own_shift");
    // Only the member the shift is for turns the caregiver's key.
    expect(await reason(person(marcus, (tx) => checkOutShift(tx, { circleId, shiftId, now: CLOCK })))).toBe("refused");
    expect(await reason(person(circle.userId, (tx) => checkOutShift(tx, { circleId, shiftId, now: CLOCK })))).toBe("refused");
    const second = await newShift(db, circle, { member: "ana", kind: "visit" });
    expect(await reason(person(ana, (tx) => confirmShift(tx, { circleId, shiftId: second, now: CLOCK })))).toBe("own_shift");
    // In a real circle, where Rose decides, a sibling's word does not count; hers does.
    const rose = await seatPerson(db, circleId, circle.members.rose);
    await db.admin.execute(sql`update circles set demo = false, clock_at = null where id = ${circleId}`);
    expect(await reason(person(marcus, (tx) => confirmShift(tx, { circleId, shiftId, now: new Date() })))).toBe("parent_can_answer");
    expect(await reason(person(circle.userId, (tx) => confirmShift(tx, { circleId, shiftId, now: new Date() })))).toBe("parent_can_answer");
    expect(await reason(person(rose, (tx) => confirmShift(tx, { circleId, shiftId, now: new Date() })))).toBe("no error");
    expect((await db.admin.execute(sql`select family_confirmation, family_confirmed_by from shifts where id = ${shiftId}`)).rows).toEqual([{ family_confirmation: "parent", family_confirmed_by: circle.members.rose }]);
  });

  it("refuse a visit under a minute in a real circle, and a confirmation before the visit began", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const circleId = circle.circleId;
    // A real visit is tapped in around its planned time, so this one is planned around the real clock.
    const hour = 60 * 60 * 1000;
    const shiftId = await newShift(db, circle, { startsAt: new Date(Date.now() - hour).toISOString(), endsAt: new Date(Date.now() + 3 * hour).toISOString() });
    expect(await reason(raw(circle.userId, sql`select kin_private.confirm_shift(${circleId}::uuid, ${shiftId}::uuid)`))).toContain("has not begun");
    await db.admin.execute(sql`update circles set demo = false, clock_at = null where id = ${circleId}`);
    await person(amara, (tx) => checkInShift(tx, { circleId, shiftId }));
    expect(await reason(person(amara, (tx) => checkOutShift(tx, { circleId, shiftId, now: new Date() })))).toBe("visit_too_short");
    // The caregiver can still call it off, and the family may too.
    await person(amara, (tx) => cancelShift(tx, { circleId, shiftId }));
  });

  it("will not pay a shift that is not confirmed, a shift that is not an aide's, or another caregiver's", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const other = await addMember(db, circle.circleId, "caregiver");
    const circleId = circle.circleId;
    const open = await newShift(db, circle);
    await person(amara, (tx) => checkInShift(tx, { circleId, shiftId: open }));
    for (const userId of [amara, circle.userId]) expect(await reason(person(userId, (tx) => settleShift(tx, { circleId, shiftId: open })))).toBe("keys_missing");
    expect(await errorCode(raw(amara, sql`select kin_private.pay_shift(${circleId}::uuid, ${open}::uuid, '{}'::jsonb)`))).toBe("KS009");
    const visit = await newShift(db, circle, { kind: "visit", member: "ana" });
    expect(await reason(person(circle.userId, (tx) => settleShift(tx, { circleId, shiftId: visit })))).toBe("not_paid_kind");
    const ready = await confirmedShift(circle, amara);
    expect(await errorCode(raw(other.userId, sql`select kin_private.pay_shift(${circleId}::uuid, ${ready}::uuid, '{}'::jsonb)`))).toBe(REFUSED.permission);
    expect(await reason(person(other.userId, (tx) => settleShift(tx, { circleId, shiftId: ready })))).toBe("refused");
  });
});

async function seededPermission(circle: VisitorCircle): Promise<string> {
  const [row] = (await db.admin.execute<{ id: string }>(sql`select id from shift_permissions where circle_id = ${circle.circleId}`)).rows;
  if (!row) throw new Error("No permission");
  return row.id;
}

describe("the permission, as the database itself checks it", () => {
  const plan = (permissionId: string, version = 1) => JSON.stringify({ outcome: "shift_permission", permissionId, agreementVersion: version });
  const pay = (userId: string, circleId: string, shiftId: string, body: string) => raw(userId, sql`select kin_private.pay_shift(${circleId}::uuid, ${shiftId}::uuid, ${body}::jsonb)`);

  it("refuses a plan that lies about the permission, the agreement, an amount or a stray field", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const circleId = circle.circleId;
    const permission = await seededPermission(circle);
    const shiftId = await confirmedShift(circle, amara);
    for (const body of [plan(randomUUID()), plan(permission, 2), JSON.stringify({ outcome: "shift_permission", permissionId: permission, agreementVersion: 1, cents: 1 }), plan("not-a-uuid"), "null", '{"outcome":"mandate","mandateId":"x","agreementVersion":1}']) {
      expect(await errorCode(pay(circle.userId, circleId, shiftId, body)), body).toBe(REFUSED.check);
    }
    expect((await db.admin.execute(sql`select 1 from shifts where id = ${shiftId} and state = 'confirmed' and proposal_id is null`)).rows).toHaveLength(1);
  });

  it("refuses a covered plan the shift does not fit: over the cap for a shift, a fifth hour in a day, a paused, revoked, expired or another caregiver's permission", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const circleId = circle.circleId;
    const elena = circle.userId;
    const terms = (change: Record<string, unknown>) => ({ payeeId: circle.payees.amara, maxMinutesPerDay: 240, perShiftCents: 15000, validFrom: "2026-10-30", expiresOn: "2027-04-30", ...change });
    const grant = async (change: Record<string, unknown>) => {
      const id = randomUUID();
      await person(elena, (tx) => grantShiftPermission(tx, { circleId, id, terms: terms(change), spokenText: null, now: CLOCK }));
      return id;
    };
    const seeded = await seededPermission(circle);
    const cheap = await grant({ perShiftCents: 3000 });
    const short = await grant({ maxMinutesPerDay: 60 });
    const paused = await grant({});
    await person(elena, (tx) => setShiftPermissionStatus(tx, { circleId, permissionId: paused, status: "paused" }));
    const revoked = await grant({});
    await person(elena, (tx) => setShiftPermissionStatus(tx, { circleId, permissionId: revoked, status: "revoked" }));
    const brief = await grant({ expiresOn: "2026-10-31" });

    // 120 minutes at 22.00: 44.00.
    const shiftId = await confirmedShift(circle, amara);
    for (const id of [cheap, short, paused, revoked]) expect(await errorCode(pay(elena, circleId, shiftId, plan(id))), id).toBe("KM010");
    // The code puts a shift outside every live permission to the family instead of paying it.
    await person(elena, (tx) => setShiftPermissionStatus(tx, { circleId, permissionId: seeded, status: "paused" }));
    // Time moves on until the brief permission has expired; a plan naming it is refused.
    await db.admin.execute(sql`update circles set clock_at = '2026-11-05T18:00:00Z' where id = ${circleId}`);
    expect(await errorCode(pay(elena, circleId, shiftId, plan(brief)))).toBe("KM010");
    // Every permission is paused, revoked or expired: Kin asks the family and says why.
    const settled = await person(elena, (tx) => settleShift(tx, { circleId, shiftId }));
    expect(settled).toMatchObject({ outcome: "asks_family", permissionId: null, askReason: "paused" });
  });

  it("counts the minutes already used in a day, so a second shift that would pass the limit asks the family", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const circleId = circle.circleId;
    const first = await confirmedShift(circle, amara, { endsAt: "2026-10-30T20:00:00Z" });
    expect(await person(circle.userId, (tx) => settleShift(tx, { circleId, shiftId: first }))).toMatchObject({ outcome: "paid_by_permission", cents: 4400 });
    // 120 more minutes fit the 240; a third such shift does not.
    const second = await confirmedShift(circle, amara, { endsAt: "2026-10-30T20:00:00Z" });
    expect(await person(circle.userId, (tx) => settleShift(tx, { circleId, shiftId: second }))).toMatchObject({ outcome: "paid_by_permission" });
    const third = await confirmedShift(circle, amara, { endsAt: "2026-10-30T20:00:00Z" });
    const turn = await person(circle.userId, (tx) => settleShift(tx, { circleId, shiftId: third }));
    expect(turn).toMatchObject({ outcome: "asks_family", askReason: "over_daily_hours" });
  });

  it("refuses to pay while the circle is paused, and a revoked permission falls to the family", async () => {
    const circle = await visitorWithCircle(db);
    const seeded = await seededPermission(circle);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const circleId = circle.circleId;
    const shiftId = await confirmedShift(circle, amara);
    await db.admin.execute(sql`update circles set paused_until = ${new Date(CLOCK.getTime() + 3_600_000).toISOString()}, paused_by = ${circle.members.elena} where id = ${circleId}`);
    expect(await reason(person(circle.userId, (tx) => settleShift(tx, { circleId, shiftId })))).toBe("paused");
    expect(await errorCode(pay(circle.userId, circleId, shiftId, plan(seeded)))).toBe("KB007");
    await db.admin.execute(sql`update circles set paused_until = null, paused_by = null where id = ${circleId}`);
    // With her permission ended, the same shift is put to the family.
    await person(circle.userId, (tx) => setShiftPermissionStatus(tx, { circleId, permissionId: seeded, status: "revoked" }));
    expect(await person(circle.userId, (tx) => settleShift(tx, { circleId, shiftId }))).toMatchObject({ outcome: "asks_family", permissionId: null, askReason: null });
  });
});

describe("a shift only moves along the diagram", () => {
  it("refuses every move the domain does not list, and the trigger says so", async () => {
    const circle = await visitorWithCircle(db);
    const circleId = circle.circleId;
    // One payment for each shift, since a payment belongs to one shift only.
    const proposalFor = async (): Promise<string> => {
      const id = randomUUID();
      await db.admin.execute(sql`insert into proposals (id, circle_id, kind, cents, payee_id, purpose, raised_at, state, agreement_version, plan)
        values (${id}, ${circleId}, 'caregiver_payout', 4400, ${circle.payees.amara}, 'shift', ${CLOCK.toISOString()}, 'pending_approval', 1, '{}'::jsonb)`);
      return id;
    };
    const insert = async (state: ShiftState): Promise<string> => {
      const id = randomUUID();
      const t = "2026-02-02T08:00:00Z";
      const inAt = state === "scheduled" || state === "cancelled" ? null : t;
      const outAt = ["checked_out", "confirmed", "priced", "paid", "credited"].includes(state) ? "2026-02-02T10:00:00Z" : null;
      const word = ["confirmed", "priced", "paid", "credited"].includes(state);
      const priced = state === "priced" || state === "paid";
      const proposal = priced ? await proposalFor() : null;
      await db.admin.execute(sql`insert into shifts (id, circle_id, kind, member_id, payee_id, starts_at, ends_at, state, checked_in_at, checked_out_at, family_confirmed_by, family_confirmed_at, family_confirmation,
          worked_minutes, billable_minutes, rate_cents_per_hour, cents, proposal_id, created_by)
        values (${id}, ${circleId}, 'aide', ${circle.members.amara}, ${circle.payees.amara}, ${t}, '2026-02-02T12:00:00Z', ${state}, ${inAt}, ${outAt},
          ${word ? circle.members.rose : null}, ${word ? "2026-02-02T10:00:00Z" : null}, ${word ? "parent" : null},
          ${priced ? 120 : null}, ${priced ? 120 : null}, ${priced ? 2200 : null}, ${priced ? 4400 : null}, ${proposal}, ${circle.members.elena})`);
      return id;
    };
    let refused = 0;
    for (const from of SHIFT_STATES) {
      for (const to of SHIFT_STATES) {
        if (from === to || (SHIFT_TRANSITIONS[from] as readonly string[]).includes(to)) continue;
        const id = await insert(from);
        const message = await db.admin.execute(sql`update shifts set state = ${to} where id = ${id}`).then(() => "moved", (error: unknown) => deepMessage(error));
        // Moving to paid is also refused by the key guard first, which asks for a settled payment.
        expect(message, `${from} to ${to}`).toMatch(to === "paid" ? /cannot move|paid only once/ : /cannot move/);
        refused += 1;
      }
    }
    expect(refused).toBe(SHIFT_STATES.length * (SHIFT_STATES.length - 1) - Object.values(SHIFT_TRANSITIONS).reduce((sum, list) => sum + list.length, 0));
  });

  it("holds every key once turned, refuses a key turned out of turn, and a shift paid before its payment settled", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const circleId = circle.circleId;
    const shiftId = await confirmedShift(circle, amara);
    expect(await errorCode(db.admin.execute(sql`update shifts set checked_in_at = checked_in_at + interval '1 minute' where id = ${shiftId}`))).toBe(REFUSED.restrict);
    expect(await errorCode(db.admin.execute(sql`update shifts set family_confirmed_by = ${circle.members.marcus} where id = ${shiftId}`))).toBe(REFUSED.restrict);
    expect(await errorCode(db.admin.execute(sql`update shifts set starts_at = starts_at + interval '1 hour' where id = ${shiftId}`))).toBe(REFUSED.restrict);
    const open = await newShift(db, circle);
    expect(await errorCode(db.admin.execute(sql`update shifts set state = 'checked_in' where id = ${open}`))).toBe(REFUSED.check);
    await person(circle.userId, (tx) => settleShift(tx, { circleId, shiftId }));
    expect(await errorCode(serviceSql(circleId, sql`update shifts set state = 'paid' where id = ${shiftId}`))).toBe(REFUSED.check);
    expect(await errorCode(db.admin.execute(sql`update shifts set cents = 1 where id = ${shiftId}`))).toBe(REFUSED.restrict);
  });
});

describe("where the money goes", () => {
  it("is the caregiver's alone to say, and the organizer cannot repoint it", async () => {
    const circle = await visitorWithCircle(db);
    const circleId = circle.circleId;
    expect(await reason(person(circle.userId, (tx) => setOwnPayoutTarget(tx, { circleId, receiver: "@elena", wallet: "venmo" })))).toBe("refused");
  });
});
