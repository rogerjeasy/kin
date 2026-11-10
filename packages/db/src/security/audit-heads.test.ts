import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { readAuditHeads, recordAuditHead } from "../audit-heads.ts";
import { auditHeads } from "../schema/index.ts";
import { asPerson, asService } from "../scope.ts";
import { DEMO_LEDGER_ENTRIES, addMember, seatPerson, visitorWithCircle } from "../testing/circles.ts";
import { testDatabases } from "../testing/databases.ts";
import { REFUSED, countIn, errorCode } from "../testing/sql.ts";

const db = testDatabases();
const COUNT = DEMO_LEDGER_ENTRIES;
const HEAD = "ab".repeat(32);

describe("audit_heads: the heads of the hash chain Kin kept", () => {
  it("keeps a head once, however often it is asked", async () => {
    const circle = await visitorWithCircle(db);
    const keep = () => asPerson(db.app, circle.userId, (tx) => recordAuditHead(tx, { circleId: circle.circleId, entryCount: COUNT, head: HEAD, kind: "verify" }));
    expect(await keep()).toBe(true);
    expect(await keep()).toBe(false);
    const heads = await asPerson(db.app, circle.userId, (tx) => readAuditHeads(tx, circle.circleId));
    expect(heads.map(({ entryCount, head }) => ({ entryCount, head }))).toEqual([{ entryCount: COUNT, head: HEAD }]);
    // The first time is also written to the audit log, the retry is not.
    const logged = await db.admin.execute<{ count: string }>(sql`select count(*) from audit_log where circle_id = ${circle.circleId} and action = 'audit_head.recorded'`);
    expect(Number(logged.rows[0]?.count)).toBe(1);
  });

  it("keeps nothing for an entry count the ledger does not hold, and refuses what is not a hash", async () => {
    const circle = await visitorWithCircle(db);
    const keep = (entryCount: number, head: string) => asPerson(db.app, circle.userId, (tx) => recordAuditHead(tx, { circleId: circle.circleId, entryCount, head, kind: "export" }));
    expect(await keep(COUNT - 1, HEAD)).toBe(false);
    expect(await asPerson(db.app, circle.userId, (tx) => readAuditHeads(tx, circle.circleId))).toEqual([]);
    expect(await errorCode(keep(COUNT, "not a hash"))).toBe(REFUSED.check);
  });

  it("is refused to an observer and a caregiver, who write nothing here", async () => {
    const circle = await visitorWithCircle(db);
    const observer = await addMember(db, circle.circleId, "observer");
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    for (const userId of [observer.userId, amara]) {
      expect(await errorCode(asPerson(db.app, userId, (tx) => recordAuditHead(tx, { circleId: circle.circleId, entryCount: COUNT, head: HEAD, kind: "verify" })))).toBe(REFUSED.permission);
    }
    const kept = await db.admin.execute<{ count: string }>(sql`select count(*) from audit_heads where circle_id = ${circle.circleId}`);
    expect(Number(kept.rows[0]?.count)).toBe(0);
  });

  it("is read by an observer and not by a caregiver", async () => {
    const circle = await visitorWithCircle(db);
    await asPerson(db.app, circle.userId, (tx) => recordAuditHead(tx, { circleId: circle.circleId, entryCount: COUNT, head: HEAD, kind: "verify" }));
    const observer = await addMember(db, circle.circleId, "observer");
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    expect(await asPerson(db.app, observer.userId, (tx) => readAuditHeads(tx, circle.circleId))).toHaveLength(1);
    expect(await asPerson(db.app, amara, (tx) => readAuditHeads(tx, circle.circleId))).toEqual([]);
  });

  it("cannot be written to another circle, or written directly by a person", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    // The operation finds no seat for a person in a circle that is not theirs.
    expect(await errorCode(asPerson(db.app, mine.userId, (tx) => recordAuditHead(tx, { circleId: theirs.circleId, entryCount: COUNT, head: HEAD, kind: "verify" })))).toBe(REFUSED.permission);
    const direct = (circleId: string, memberId: string) =>
      errorCode(asPerson(db.app, mine.userId, (tx) => tx.insert(auditHeads).values({ id: randomUUID(), circleId, entryCount: COUNT, head: HEAD, kind: "verify", recordedBy: memberId })));
    expect(await direct(mine.circleId, mine.members.amara)).toBe(REFUSED.permission);
    expect(await direct(theirs.circleId, theirs.members.amara)).toBe(REFUSED.permission);
    // Another circle's heads are invisible, to the person and to a service that names a different circle.
    await asPerson(db.app, theirs.userId, (tx) => recordAuditHead(tx, { circleId: theirs.circleId, entryCount: COUNT, head: HEAD, kind: "verify" }));
    expect(await asPerson(db.app, mine.userId, (tx) => readAuditHeads(tx, theirs.circleId))).toEqual([]);
    await asService(db.service, mine.circleId, async (tx) => {
      expect(await countIn(tx, "audit_heads", theirs.circleId)).toBe(0);
    });
    expect(await errorCode(asService(db.service, mine.circleId, (tx) => tx.insert(auditHeads).values({ id: randomUUID(), circleId: theirs.circleId, entryCount: COUNT, head: HEAD, kind: "verify", recordedBy: theirs.members.amara })))).toBe(REFUSED.permission);
  });

  it("can never be changed, removed or emptied, even by the database's own administrator", async () => {
    const circle = await visitorWithCircle(db);
    await asPerson(db.app, circle.userId, (tx) => recordAuditHead(tx, { circleId: circle.circleId, entryCount: COUNT, head: HEAD, kind: "verify" }));
    expect(await errorCode(db.admin.execute(sql`update audit_heads set head = ${"cd".repeat(32)} where circle_id = ${circle.circleId}`))).toBe(REFUSED.restrict);
    expect(await errorCode(db.admin.execute(sql`delete from audit_heads where circle_id = ${circle.circleId}`))).toBe(REFUSED.restrict);
    expect(await errorCode(db.admin.execute(sql`truncate audit_heads`))).toBe(REFUSED.restrict);
  });
});
