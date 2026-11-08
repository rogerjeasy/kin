import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { creditShift } from "../shift-credit.ts";
import { asPerson, asService } from "../scope.ts";
import { confirmedVisit, visitorWithCircle } from "../testing/index.ts";
import { testDatabases } from "../testing/databases.ts";
import { newShift } from "../testing/shifts.ts";
import { REFUSED, errorCode } from "../testing/sql.ts";

const db = testDatabases();

const serviceSql = (circleId: string, query: ReturnType<typeof sql>) => asService(db.service, circleId, (tx) => tx.execute(query));
const insertCare = (circleId: string, shiftId: string, memberId: string, minutes: number, ledgerEntryId: string | null) =>
  serviceSql(circleId, sql`insert into care_entries (id, circle_id, member_id, occurred_on, minutes, approved, ledger_entry_id, shift_id)
    values (gen_random_uuid(), ${circleId}, ${memberId}, '2026-10-30', ${minutes}, true, ${ledgerEntryId}, ${shiftId})`);
/** Any care-credit entry of the circle, only so that a care entry has a ledger entry to point at. */
const someCareEntry = async (circleId: string): Promise<string> => {
  const rows = (await serviceSql(circleId, sql`select id from ledger_entries where kind = 'care_credit' limit 1`)).rows as { id: string }[];
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("The demo circle has a care credit");
  return id;
};

describe("who may credit a visit", () => {
  it("gives no person a way to credit one, and the service only together with the care entry that records it", async () => {
    const circle = await visitorWithCircle(db);
    const visit = await confirmedVisit(db, circle);
    const circleId = circle.circleId;
    const personQuery = (userId: string, query: ReturnType<typeof sql>) => asPerson(db.app, userId, (tx) => tx.execute(query));
    for (const userId of [circle.userId, visit.memberUserId]) {
      expect(await errorCode(personQuery(userId, sql`update shifts set state = 'credited' where id = ${visit.shiftId}`))).toBe(REFUSED.permission);
      expect(await errorCode(personQuery(userId, sql`insert into care_entries (id, circle_id, member_id, occurred_on, minutes, approved, shift_id) values (gen_random_uuid(), ${circleId}, ${circle.members.ana}, '2026-10-30', 45, true, ${visit.shiftId})`))).toBe(REFUSED.permission);
      expect(await errorCode(personQuery(userId, sql`update care_entries set minutes = 1`))).toBe(REFUSED.permission);
    }
    // The service, with no care entry behind it, and the owner, who is not the service, are both refused.
    expect(await errorCode(serviceSql(circleId, sql`update shifts set state = 'credited' where id = ${visit.shiftId}`))).toBe(REFUSED.check);
    expect(await errorCode(db.admin.execute(sql`update shifts set state = 'credited' where id = ${visit.shiftId}`))).toBe(REFUSED.permission);
    expect((await db.admin.execute<{ state: string }>(sql`select state from shifts where id = ${visit.shiftId}`)).rows).toEqual([{ state: "confirmed" }]);
  });

  it("takes a care entry from a shift only while it is confirmed, for the member who did it and for exactly the minutes between the taps", async () => {
    const circle = await visitorWithCircle(db);
    const circleId = circle.circleId;
    const visit = await confirmedVisit(db, circle);
    const entry = await someCareEntry(circleId);
    expect(await errorCode(insertCare(circleId, visit.shiftId, circle.members.ana, visit.minutes + 1, entry))).toBe(REFUSED.check);
    expect(await errorCode(insertCare(circleId, visit.shiftId, circle.members.ana, visit.minutes - 1, entry))).toBe(REFUSED.check);
    expect(await errorCode(insertCare(circleId, visit.shiftId, circle.members.marcus, visit.minutes, entry))).toBe(REFUSED.check);
    // A shift that is only planned has no taps to credit; a care entry for a shift cannot lack its ledger entry.
    const planned = await newShift(db, circle, { kind: "visit", member: "ana" });
    expect(await errorCode(insertCare(circleId, planned, circle.members.ana, 45, entry))).toBe(REFUSED.check);
    expect(await errorCode(insertCare(circleId, visit.shiftId, circle.members.ana, visit.minutes, null))).toBe(REFUSED.check);
    // A shift that does not exist has nothing to credit.
    expect(await errorCode(insertCare(circleId, randomUUID(), circle.members.ana, 60, entry))).toBe(REFUSED.check);
    // The one entry that fits is taken, and a second for the same shift is not.
    expect(await errorCode(insertCare(circleId, visit.shiftId, circle.members.ana, visit.minutes, entry))).toBe("no error");
    expect(await errorCode(insertCare(circleId, visit.shiftId, circle.members.ana, visit.minutes, entry))).toBe(REFUSED.unique);
  });

  it("holds a credit once written: it cannot be edited, linked to another shift, or credited from another circle", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    const visit = await confirmedVisit(db, mine);
    const other = await confirmedVisit(db, mine, { member: "marcus" });
    await asService(db.service, mine.circleId, (tx) => creditShift(tx, mine.circleId, visit.shiftId));
    await asService(db.service, mine.circleId, (tx) => creditShift(tx, mine.circleId, other.shiftId));
    const waiting = await confirmedVisit(db, mine);
    expect(await errorCode(serviceSql(mine.circleId, sql`update care_entries set minutes = 1 where shift_id = ${visit.shiftId}`))).toBe(REFUSED.restrict);
    expect(await errorCode(serviceSql(mine.circleId, sql`update care_entries set shift_id = ${other.shiftId} where shift_id = ${visit.shiftId}`))).toBe(REFUSED.restrict);
    expect(await errorCode(serviceSql(mine.circleId, sql`update care_entries set shift_id = null where shift_id = ${visit.shiftId}`))).toBe(REFUSED.restrict);
    expect(await errorCode(serviceSql(mine.circleId, sql`delete from care_entries where shift_id = ${visit.shiftId}`))).toBe(REFUSED.permission);
    // A credited visit does not go back, or into pricing.
    expect(await errorCode(db.admin.execute(sql`update shifts set state = 'confirmed' where id = ${visit.shiftId}`))).toBe(REFUSED.check);
    expect(await errorCode(db.admin.execute(sql`update shifts set state = 'priced' where id = ${visit.shiftId}`))).toBe(REFUSED.check);
    // Another circle's service neither reads this circle's credit nor writes one for it.
    expect((await serviceSql(theirs.circleId, sql`select id from care_entries where shift_id = ${visit.shiftId}`)).rows).toEqual([]);
    expect(await errorCode(serviceSql(theirs.circleId, sql`insert into care_entries (id, circle_id, member_id, occurred_on, minutes, approved, shift_id) values (gen_random_uuid(), ${mine.circleId}, ${mine.members.ana}, '2026-10-30', ${waiting.minutes}, true, ${waiting.shiftId})`))).toBe(REFUSED.permission);
    expect((await asService(db.service, theirs.circleId, (tx) => creditShift(tx, theirs.circleId, visit.shiftId)))).toBe("not_creditable");
    // And nobody outside the circle reads it.
    const outside = await asPerson(db.app, theirs.userId, (tx) => tx.execute<{ n: string }>(sql`select count(*) as n from care_entries where circle_id = ${mine.circleId}`));
    expect(outside.rows[0]?.n).toBe("0");
  });
});
