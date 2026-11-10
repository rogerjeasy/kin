import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { QuietShareError, acceptMyQuietSharePart, raiseQuietShare, readQuietShares, sealMyOffer, spreadQuietShare, takeQuietShareGap, withdrawQuietShare } from "../quiet-shares.ts";
import { asPerson, asService } from "../scope.ts";
import { addMember, seatPerson, visitorWithCircle, type VisitorCircle } from "../testing/index.ts";
import { testDatabases } from "../testing/databases.ts";
import { REFUSED, countIn, errorCode } from "../testing/sql.ts";

const db = testDatabases();

const offer = { monthlyCents: 6_000, stepUp: null, careTrips: 0, careMinutes: 0, earliestMonth: null };
const reason = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
    return "no error";
  } catch (error) {
    return error instanceof QuietShareError ? error.reason : `uncoded: ${String(error)}`;
  }
};

/** Everyone's seat in a demo circle, and the waiting stairlift ask. */
async function seats(circle: VisitorCircle) {
  const [marcus, ana, rose, amara, daniel] = await Promise.all(
    [circle.members.marcus, circle.members.ana, circle.members.rose, circle.members.amara, circle.members.daniel].map((memberId) => seatPerson(db, circle.circleId, memberId)),
  );
  const askId = (await db.admin.execute<{ id: string }>(sql`select id from quiet_share_asks where circle_id = ${circle.circleId}`)).rows[0]?.id;
  if (!askId) throw new Error("No seeded ask");
  return { elena: circle.userId, marcus: marcus as string, ana: ana as string, rose: rose as string, amara: amara as string, daniel: daniel as string, askId };
}

const count = (userId: string, table: string, circleId: string) => asPerson(db.app, userId, (tx) => countIn(tx, table, circleId));
const seal = (userId: string, circle: VisitorCircle, askId: string) => asPerson(db.app, userId, (tx) => sealMyOffer(tx, { circleId: circle.circleId, askId, offer }));

describe("a sealed offer is read by its author alone", () => {
  it("hides Elena's offer from the other sharers, the parent, the observer and the caregiver, and shows it to her", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    expect(await count(people.elena, "sealed_offers", circle.circleId)).toBe(1);
    for (const userId of [people.marcus, people.ana, people.rose, people.daniel, people.amara]) {
      expect(await count(userId, "sealed_offers", circle.circleId)).toBe(0);
    }
    // Even an organizer who is not its author reads nothing: Marcus's offer is his own, and the organizer's view of it is empty.
    await seal(people.marcus, circle, people.askId);
    expect(await asPerson(db.app, people.elena, (tx) => tx.execute(sql`select member_id from sealed_offers where circle_id = ${circle.circleId}`))).toMatchObject({ rows: [{ member_id: circle.members.elena }] });
  });

  it("shows each person only their own part of the plan, and the ask, not the parts, to everyone who sees the money", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    await seal(people.marcus, circle, people.askId);
    await seal(people.ana, circle, people.askId);
    for (const userId of [people.elena, people.marcus, people.ana]) expect(await count(userId, "quiet_share_parts", circle.circleId)).toBe(1);
    for (const userId of [people.rose, people.daniel, people.amara]) expect(await count(userId, "quiet_share_parts", circle.circleId)).toBe(0);
    for (const userId of [people.elena, people.marcus, people.rose, people.daniel]) expect(await count(userId, "quiet_share_asks", circle.circleId)).toBe(1);
    // A caregiver does not see the circle's money, so not its asks either.
    expect(await count(people.amara, "quiet_share_asks", circle.circleId)).toBe(0);
  });

  it("shows Kin's service no offer and no part, only the ask of the circle it acts for", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    await seal(people.marcus, circle, people.askId);
    await seal(people.ana, circle, people.askId);
    await asService(db.service, circle.circleId, async (tx) => {
      expect(await countIn(tx, "sealed_offers", circle.circleId)).toBe(0);
      expect(await countIn(tx, "quiet_share_parts", circle.circleId)).toBe(0);
      expect(await countIn(tx, "quiet_share_asks", circle.circleId)).toBe(1);
    });
  });

  it("keeps every amount of an offer out of the record of what was done", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    await seal(people.marcus, circle, people.askId);
    const logged = await db.admin.execute<{ details: unknown }>(sql`select details from audit_log where circle_id = ${circle.circleId} and action = 'quiet_share.offer_sealed'`);
    expect(logged.rows).toEqual([{ details: {} }]);
  });
});

describe("what the organizer can learn from the record of what was done", () => {
  it("never who sealed an offer or who took the gap on with Pay Later", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    await asPerson(db.app, people.marcus, (tx) => sealMyOffer(tx, { circleId: circle.circleId, askId: people.askId, offer: { ...offer, monthlyCents: 40_000 } }));
    await seal(people.ana, circle, people.askId);
    expect(await asPerson(db.app, people.marcus, (tx) => takeQuietShareGap(tx, { circleId: circle.circleId, askId: people.askId }))).toBe("planned");
    const logged = await asPerson(db.app, people.elena, (tx) =>
      tx.execute<{ action: string; actor: string; member_id: string | null; details: unknown }>(
        sql`select action, actor, member_id, details from audit_log where circle_id = ${circle.circleId} and action like 'quiet_share.%' order by sequence`,
      ),
    );
    // The organizer does read the audit log, so this is exactly what they see.
    expect(logged.rows.map((row) => row.action)).toEqual(["quiet_share.offer_sealed", "quiet_share.offer_sealed", "quiet_share.mediated", "quiet_share.gap_taken", "quiet_share.mediated"]);
    for (const row of logged.rows) {
      expect(row).toMatchObject({ actor: "service", member_id: null });
      expect(JSON.stringify(row.details)).not.toContain(circle.members.marcus);
      expect(JSON.stringify(row.details)).not.toContain(circle.members.ana);
    }
  });
});

describe("a part's figures reach their own person only", () => {
  it("returns Ana's at-limit part, her share and her care to her alone, and none of it to the organizer or the other sharer", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    await asPerson(db.app, people.marcus, (tx) => sealMyOffer(tx, { circleId: circle.circleId, askId: people.askId, offer: { ...offer, monthlyCents: 60_000 } }));
    await asPerson(db.app, people.ana, (tx) => sealMyOffer(tx, { circleId: circle.circleId, askId: people.askId, offer: { ...offer, careTrips: 2, careMinutes: 180 } }));
    const view = (userId: string, memberId: string) => asPerson(db.app, userId, (tx) => readQuietShares(tx, { circleId: circle.circleId, memberId }));
    const [ana] = await view(people.ana, circle.members.ana);
    expect(ana?.myPart).toMatchObject({ cents: 6_000, atLimit: true, shareCents: 18_000, careTrips: 2 });
    // Even naming Ana's seat, another person reads back nothing of hers: row-level security decides, not the argument.
    for (const [userId, own] of [[people.elena, 30_000], [people.marcus, 54_000]] as const) {
      const [theirs] = await view(userId, circle.members.ana);
      expect(theirs?.myPart).toBeNull();
      expect(theirs?.myOffer).toBeNull();
      const [mine] = await view(userId, userId === people.elena ? circle.members.elena : circle.members.marcus);
      expect(mine?.myPart?.cents).toBe(own);
      expect(mine?.myPart?.atLimit).toBe(false);
      expect(JSON.stringify({ part: mine?.myPart, offer: mine?.myOffer })).not.toMatch(/[^0-9](6000|18000)[^0-9]/u);
      const raw = await asPerson(db.app, userId, (tx) => tx.execute<{ member_id: string }>(sql`select member_id from quiet_share_parts where ask_id = ${people.askId}`));
      expect(raw.rows.every((row) => row.member_id !== circle.members.ana)).toBe(true);
    }
  });
});

describe("who may ask, answer and decide", () => {
  it("refuses the least-privileged roles first: an observer, a caregiver and the parent cannot seal, take the gap or accept a part", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    for (const userId of [people.daniel, people.amara, people.rose]) {
      expect(await reason(seal(userId, circle, people.askId))).toBe("refused");
      expect(await reason(asPerson(db.app, userId, (tx) => takeQuietShareGap(tx, { circleId: circle.circleId, askId: people.askId })))).toBe("refused");
      expect(await reason(asPerson(db.app, userId, (tx) => acceptMyQuietSharePart(tx, { circleId: circle.circleId, askId: people.askId, method: "checkout" })))).toBe("refused");
      expect(await reason(asPerson(db.app, userId, (tx) => raiseQuietShare(tx, { circleId: circle.circleId, title: "x", kind: "one_off", costCents: 100, billId: null })))).toBe("refused");
      expect(await reason(asPerson(db.app, userId, (tx) => withdrawQuietShare(tx, { circleId: circle.circleId, askId: people.askId })))).toBe("refused");
    }
    expect(await reason(asPerson(db.app, people.ana, (tx) => withdrawQuietShare(tx, { circleId: circle.circleId, askId: people.askId })))).toBe("refused");
    expect(await reason(asPerson(db.app, people.ana, (tx) => spreadQuietShare(tx, { circleId: circle.circleId, askId: people.askId })))).toBe("refused");
  });

  it("refuses a contributor who is not asked, since they hold no share", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const newcomer = await addMember(db, circle.circleId, "contributor");
    expect(await reason(seal(newcomer.userId, circle, people.askId))).toBe("refused");
  });

  it("lets no person write the tables directly, only through the operations", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const attempt = (userId: string, query: ReturnType<typeof sql>) => errorCode(asPerson(db.app, userId, (tx) => tx.execute(query)));
    expect(await attempt(people.elena, sql`update quiet_share_asks set cost_cents = 1 where id = ${people.askId}`)).toBe(REFUSED.permission);
    expect(await attempt(people.elena, sql`update sealed_offers set monthly_cents = 1 where ask_id = ${people.askId}`)).toBe(REFUSED.permission);
    expect(await attempt(people.marcus, sql`insert into sealed_offers (id, circle_id, ask_id, member_id, monthly_cents, sealed_at) values (${randomUUID()}, ${circle.circleId}, ${people.askId}, ${circle.members.marcus}, 1, now())`)).toBe(REFUSED.permission);
    expect(await attempt(people.marcus, sql`select kin_private.mediate_quiet_share(${circle.circleId}::uuid, ${people.askId}::uuid)`)).toBe(REFUSED.permission);
    expect(await attempt(people.marcus, sql`select kin_private.mediate_offers(100, '2026-11', 1, null, '[]'::jsonb)`)).toBe(REFUSED.permission);
  });
});

describe("one family never touches another's quiet shares", () => {
  it("cannot read, seal into, accept or withdraw another circle's ask", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    const people = await seats(theirs);
    for (const table of ["quiet_share_asks", "sealed_offers", "quiet_share_parts"]) expect(await count(mine.userId, table, theirs.circleId)).toBe(0);
    expect(await reason(seal(mine.userId, theirs, people.askId))).toBe("refused");
    expect(await reason(asPerson(db.app, mine.userId, (tx) => sealMyOffer(tx, { circleId: mine.circleId, askId: people.askId, offer })))).toBe("refused");
    expect(await reason(asPerson(db.app, mine.userId, (tx) => withdrawQuietShare(tx, { circleId: theirs.circleId, askId: people.askId })))).toBe("refused");
    expect(await reason(asPerson(db.app, mine.userId, (tx) => acceptMyQuietSharePart(tx, { circleId: theirs.circleId, askId: people.askId, method: "checkout" })))).toBe("refused");
  });
});

describe("what the database holds to", () => {
  it("moves an ask only along its diagram, and never changes what it covers or a part's figures", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    await seal(people.marcus, circle, people.askId);
    await seal(people.ana, circle, people.askId);
    const owner = (query: ReturnType<typeof sql>) => errorCode(db.admin.execute(query));
    expect(await owner(sql`update quiet_share_asks set state = 'gathering' where id = ${people.askId}`)).toBe(REFUSED.check);
    expect(await owner(sql`update quiet_share_asks set cost_cents = 100 where id = ${people.askId}`)).toBe(REFUSED.restrict);
    expect(await owner(sql`update quiet_share_parts set cents = 1 where ask_id = ${people.askId}`)).toBe(REFUSED.restrict);
    expect(await owner(sql`delete from sealed_offers where ask_id = ${people.askId}`)).toBe(REFUSED.restrict);
  });
});
