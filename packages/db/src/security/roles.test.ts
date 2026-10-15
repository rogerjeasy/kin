import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { readCircle } from "../read-circle.ts";
import { circles, ledgerEntries, members, payees, proposals, users } from "../schema/index.ts";
import { asPerson, asProvisioner, asService } from "../scope.ts";
import { addMember, seatPerson, visitorWithCircle } from "../testing/circles.ts";
import { testDatabases } from "../testing/databases.ts";
import { REFUSED, countIn, errorCode } from "../testing/sql.ts";

const db = testDatabases();
const now = new Date();

describe("a caregiver (the least-privileged role that reads money)", () => {
  it("sees only their own payee, payments and proposals, and none of the family's terms", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const snapshot = await asPerson(db.app, amara, (tx) => readCircle(tx, { circleId: circle.circleId, userId: amara, now }));

    expect(snapshot.viewer.role).toBe("caregiver");
    expect(snapshot.payees.map((payee) => payee.id)).toEqual([circle.payees.amara]);
    expect(snapshot.proposals.map((proposal) => proposal.purpose)).toEqual(["caregiverWeek"]);
    // The approval and the confirmed payout of her twelve hours, each read whole.
    expect(snapshot.ledger.entries.map((entry) => entry.kind).toSorted()).toEqual(["bill_approved", "payout_confirmed"]);
    expect(snapshot.ledger.entries.every((entry) => entry.lines.some((line) => line.account === `payable:${circle.payees.amara}`))).toBe(true);
    expect(snapshot.bills.every((bill) => bill.payeeId === circle.payees.amara)).toBe(true);
    expect(snapshot.expectedBills.every((bill) => bill.payeeId === circle.payees.amara)).toBe(true);
    expect(snapshot.agreement).toBeNull();
    expect([snapshot.settlements, snapshot.claimChecks, snapshot.narrations, snapshot.careEntries, snapshot.documents]).toEqual([[], [], [], [], []]);
    // She still sees who is in the circle.
    expect(snapshot.members).toHaveLength(6);
  });

  it("cannot read the audit log or invitations", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    await asPerson(db.app, amara, async (tx) => {
      expect(await countIn(tx, "audit_log", circle.circleId)).toBe(0);
    });
  });
});

describe("an observer", () => {
  it("reads the whole circle's money", async () => {
    const circle = await visitorWithCircle(db);
    const observer = await addMember(db, circle.circleId, "observer");
    const snapshot = await asPerson(db.app, observer.userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId: observer.userId, now }));
    expect(snapshot.viewer.role).toBe("observer");
    expect(snapshot.ledger.entries.length).toBeGreaterThan(10);
    expect(snapshot.agreement?.shares).toHaveLength(3);
  });

  it("writes nothing: the database refuses, whatever the screen offers", async () => {
    const circle = await visitorWithCircle(db);
    const observer = await addMember(db, circle.circleId, "observer");
    const attempt = (work: Parameters<typeof asPerson>[2]) => errorCode(asPerson(db.app, observer.userId, work));
    // A proposal's state is open to answering roles only, so an observer's update finds no row.
    const moved = await asPerson(db.app, observer.userId, (tx) =>
      tx.update(proposals).set({ state: "approved" }).where(eq(proposals.circleId, circle.circleId)).returning({ id: proposals.id }),
    );
    expect(moved).toEqual([]);
    expect(await attempt((tx) => tx.delete(members).where(eq(members.circleId, circle.circleId)))).toBe(REFUSED.permission);
    // Nor can an observer pull the pause switch.
    const paused = await asPerson(db.app, observer.userId, (tx) =>
      tx.update(circles).set({ pausedUntil: new Date(), pausedBy: observer.memberId }).where(eq(circles.id, circle.circleId)).returning({ id: circles.id }),
    );
    expect(paused).toEqual([]);
  });
});

describe("any member, the organizer included", () => {
  it("cannot write the ledger, move a proposal or change who is paid", async () => {
    const circle = await visitorWithCircle(db);
    const attempt = (work: Parameters<typeof asPerson>[2]) => errorCode(asPerson(db.app, circle.userId, work));
    // Approving takes a recorded yes: the database refuses a bare change of state.
    expect(await attempt((tx) => tx.update(proposals).set({ state: "approved" }).where(eq(proposals.circleId, circle.circleId)))).toBe(REFUSED.check);
    expect(await attempt((tx) => tx.update(proposals).set({ cents: 1 }).where(eq(proposals.circleId, circle.circleId)))).toBe(REFUSED.permission);
    expect(await attempt((tx) => tx.update(payees).set({ paypalReceiver: "thief@example.com" }).where(eq(payees.circleId, circle.circleId)))).toBe(REFUSED.permission);
    expect(await attempt((tx) => tx.delete(ledgerEntries).where(eq(ledgerEntries.circleId, circle.circleId)))).toBe(REFUSED.permission);
    expect(await attempt((tx) => tx.update(circles).set({ name: "Renamed" }).where(eq(circles.id, circle.circleId)))).toBe(REFUSED.permission);
  });

  it("can keep only their own user row", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    const changed = await asPerson(db.app, mine.userId, (tx) =>
      tx.update(users).set({ name: "Changed" }).where(eq(users.id, theirs.userId)).returning({ id: users.id }),
    );
    expect(changed).toEqual([]);
    expect(
      await errorCode(asPerson(db.app, mine.userId, (tx) => tx.insert(users).values({ id: randomUUID(), email: "x@example.com", name: "Someone else" }))),
    ).toBe(REFUSED.permission);
  });

  it("cannot hand themselves a seat in another circle", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    expect(
      await errorCode(
        asPerson(db.app, mine.userId, (tx) =>
          tx.insert(members).values({ id: randomUUID(), circleId: theirs.circleId, userId: mine.userId, displayName: "Intruder", role: "organizer" }),
        ),
      ),
    ).toBe(REFUSED.permission);
  });
});

describe("the demo provisioner", () => {
  it("reads nothing, not even the circles it made", async () => {
    const circle = await visitorWithCircle(db);
    expect(await errorCode(asProvisioner(db.provisioner, (tx) => countIn(tx, "circles", circle.circleId)))).toBe(REFUSED.permission);
    expect(await errorCode(asProvisioner(db.provisioner, (tx) => tx.select().from(users)))).toBe(REFUSED.permission);
  });

  it("cannot add a row to a circle it did not create in the same transaction", async () => {
    const victim = await visitorWithCircle(db);
    const intruder = asProvisioner(db.provisioner, (tx) =>
      tx.insert(members).values({ id: randomUUID(), circleId: victim.circleId, displayName: "Intruder", role: "organizer" }),
    );
    expect(await errorCode(intruder)).toBe(REFUSED.permission);
  });

  it("can create only demo circles, never a real one", async () => {
    const real = asProvisioner(db.provisioner, (tx) =>
      tx.insert(circles).values({ id: randomUUID(), name: "Real family", timezone: "UTC", currency: "USD", demo: false }),
    );
    expect(await errorCode(real)).toBe(REFUSED.permission);
  });

  it("cannot forge the transaction mark that lets it fill a circle", async () => {
    const forged = asProvisioner(db.provisioner, (tx) =>
      tx.insert(circles).values({ id: randomUUID(), name: "Forged", timezone: "UTC", currency: "USD", demo: true, provisionedTxid: 1 }),
    );
    expect(await errorCode(forged)).toBe(REFUSED.permission);
  });
});

describe("Kin's service", () => {
  it("cannot write into a circle other than the one its job names", async () => {
    const [job, other] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    const moved = await asService(db.service, job.circleId, (tx) =>
      tx.update(members).set({ displayName: "Changed" }).where(eq(members.circleId, other.circleId)).returning({ id: members.id }),
    );
    expect(moved).toEqual([]);
    const planted = asService(db.service, job.circleId, (tx) =>
      tx.insert(members).values({ id: randomUUID(), circleId: other.circleId, displayName: "Planted", role: "organizer" }),
    );
    expect(await errorCode(planted)).toBe(REFUSED.permission);
  });

  it("without a circle named, sees nothing", async () => {
    const circle = await visitorWithCircle(db);
    const rows = await db.service.transaction((tx) => tx.execute<{ count: string }>(sql`select count(*) from members where circle_id = ${circle.circleId}`));
    expect(Number(rows.rows[0]?.count)).toBe(0);
  });
});
