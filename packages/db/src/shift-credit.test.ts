import { calculateFairness, careCreditLogged, careValueCents, periodInputs } from "@kin/domain";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { SHIFT_CREDIT_TOPIC, creditShift, shiftCreditSourceId } from "./shift-credit.ts";
import { readAccountIds, writeEntries } from "./ledger-store.ts";
import { asPerson, asService } from "./scope.ts";
import { checkInShift, checkOutShift, confirmShift } from "./shifts.ts";
import { agreeWithoutCare, confirmedVisit, seatPerson, serviceRows, snapshotFor, testDatabases, visitorWithCircle } from "./testing/index.ts";
import { CLOCK, newShift } from "./testing/shifts.ts";

const db = testDatabases();

/** Ana's October, valued as the dashboard values it: the circle's ledger and agreement in force, through the money core. */
async function octoberFor(userId: string, circleId: string, memberId: string) {
  const snapshot = await snapshotFor(db, userId, circleId);
  if (!snapshot.agreement) throw new Error("The demo circle has an agreement");
  const inputs = periodInputs({ ledger: snapshot.ledger, agreement: snapshot.agreement, period: "2026-10" });
  const fairness = calculateFairness(inputs);
  const member = inputs.members.find((each) => each.memberId === memberId);
  const position = fairness.positions.find((each) => each.memberId === memberId);
  if (!member || !position) throw new Error("The member has no share");
  return { snapshot, careCreditCents: member.careCreditCents, contributedCents: position.contributedCents, positionCents: position.positionCents };
}

const rows = (circleId: string, text: string, params: readonly unknown[] = []) => serviceRows(db, circleId, text, params);
const credit = (circleId: string, shiftId: string) => asService(db.service, circleId, (tx) => creditShift(tx, circleId, shiftId));

describe("a sibling's confirmed visit counts toward their fair share", () => {
  it("queues the visit in the transaction that confirms it, and credits it into the month's fairness inputs and result", async () => {
    const circle = await visitorWithCircle(db);
    const before = await octoberFor(circle.userId, circle.circleId, circle.members.ana);
    const visit = await confirmedVisit(db, circle);
    expect(visit.minutes).toBe(45);
    expect(await rows(circle.circleId, "select payload, sent_at from outbox where topic = $1 and circle_id = $2", [SHIFT_CREDIT_TOPIC, circle.circleId])).toEqual([
      { payload: { shiftId: visit.shiftId }, sent_at: null },
    ]);

    expect(await credit(circle.circleId, visit.shiftId)).toBe("credited");

    // 45 minutes at the agreement's rate of 20.00 an hour.
    const cents = careValueCents(45, 2_000);
    expect(cents).toBe(1_500);
    const after = await octoberFor(circle.userId, circle.circleId, circle.members.ana);
    expect(after.careCreditCents).toBe(before.careCreditCents + cents);
    expect(after.contributedCents).toBe(before.contributedCents + cents);
    // The member's own share of what the circle gave also rose, so the position moves by less than the credit.
    expect(after.positionCents).toBeGreaterThan(before.positionCents);

    const shift = after.snapshot.shifts.find((each) => each.id === visit.shiftId);
    expect(shift).toMatchObject({ state: "credited", creditedMinutes: 45, creditedCents: cents });
    const [entry] = after.snapshot.ledger.entries.filter((each) => each.source.id === shiftCreditSourceId(visit.shiftId));
    expect(entry).toMatchObject({ kind: "care_credit", simulated: true, source: { type: "approval" }, period: "2026-10", occurredOn: "2026-10-30", description: "Care visit credited (simulated)" });
    expect(await rows(circle.circleId, "select minutes, approved, member_id, ledger_entry_id from care_entries where shift_id = $1", [visit.shiftId])).toEqual([
      { minutes: 45, approved: true, member_id: circle.members.ana, ledger_entry_id: entry?.id },
    ]);
    expect(await rows(circle.circleId, "select details from audit_log where action = 'shift.credited' and subject_id = $1", [visit.shiftId])).toHaveLength(1);
    // The credited visit is in the record Ana's own seat reads, and her sibling's view of it is the same figure.
    const hers = await snapshotFor(db, visit.memberUserId, circle.circleId);
    expect(hers.shifts.find((each) => each.id === visit.shiftId)).toMatchObject({ creditedMinutes: 45, creditedCents: cents });
  });

  it("credits a drive the same way, at the minutes between the taps and no more", async () => {
    const circle = await visitorWithCircle(db);
    const visit = await confirmedVisit(db, circle, { kind: "drive", member: "marcus", endsAt: "2026-10-30T19:20:00Z" });
    expect(await credit(circle.circleId, visit.shiftId)).toBe("credited");
    const [row] = await rows(circle.circleId, "select minutes from care_entries where shift_id = $1", [visit.shiftId]);
    expect(row).toEqual({ minutes: 80 });
    expect((await snapshotFor(db, circle.userId, circle.circleId)).ledger.entries.find((each) => each.source.id === shiftCreditSourceId(visit.shiftId))?.description).toBe("Care drive credited (simulated)");
  });

  it("credits a visit once, however many times it is asked", async () => {
    const circle = await visitorWithCircle(db);
    const visit = await confirmedVisit(db, circle);
    expect(await credit(circle.circleId, visit.shiftId)).toBe("credited");
    expect(await credit(circle.circleId, visit.shiftId)).toBe("already_credited");
    expect(await rows(circle.circleId, "select count(*)::int as n from ledger_entries where source_id = $1", [shiftCreditSourceId(visit.shiftId)])).toEqual([{ n: 1 }]);
    expect(await rows(circle.circleId, "select count(*)::int as n from care_entries where shift_id = $1", [visit.shiftId])).toEqual([{ n: 1 }]);
  });

  it("finds the ledger entry a crashed first try wrote, and links it instead of writing a second", async () => {
    const circle = await visitorWithCircle(db);
    const visit = await confirmedVisit(db, circle);
    // The entry is there; the care entry and the move to credited are not.
    await asService(db.service, circle.circleId, async (tx) => {
      const entry = careCreditLogged(
        { id: randomUUID(), circleId: circle.circleId, occurredOn: "2026-10-30", period: "2026-10", source: { type: "approval", id: shiftCreditSourceId(visit.shiftId) }, currency: "USD", simulated: true, description: "Care visit credited (simulated)" },
        { memberId: circle.members.ana, minutes: 45, rateCentsPerHour: 2_000 },
      );
      await writeEntries(tx, [entry], await readAccountIds(tx, circle.circleId));
    });
    expect(await credit(circle.circleId, visit.shiftId)).toBe("credited");
    expect(await rows(circle.circleId, "select count(*)::int as n from ledger_entries where source_id = $1", [shiftCreditSourceId(visit.shiftId)])).toEqual([{ n: 1 }]);
    expect(await rows(circle.circleId, "select state from shifts where id = $1", [visit.shiftId])).toEqual([{ state: "credited" }]);
  });

  it("leaves the visit confirmed, and says so once, when the agreement counts no care time", async () => {
    const circle = await visitorWithCircle(db);
    await agreeWithoutCare(db, circle);
    const visit = await confirmedVisit(db, circle);
    for (let attempt = 0; attempt < 3; attempt += 1) expect(await credit(circle.circleId, visit.shiftId)).toBe("no_care_terms");
    expect(await rows(circle.circleId, "select state from shifts where id = $1", [visit.shiftId])).toEqual([{ state: "confirmed" }]);
    expect(await rows(circle.circleId, "select details from audit_log where action = 'shift.credit_skipped' and subject_id = $1", [visit.shiftId])).toEqual([{ details: { reason: "no_care_terms" } }]);
    expect(await rows(circle.circleId, "select count(*)::int as n from ledger_entries where source_id = $1", [shiftCreditSourceId(visit.shiftId)])).toEqual([{ n: 0 }]);
    expect(await rows(circle.circleId, "select count(*)::int as n from care_entries where shift_id = $1", [visit.shiftId])).toEqual([{ n: 0 }]);
  });

  it("does not credit a visit whose member no longer shares the cost, and ignores a shift that does not exist", async () => {
    const circle = await visitorWithCircle(db);
    const visit = await confirmedVisit(db, circle);
    await db.admin.execute(sql`update members set role = 'observer' where id = ${circle.members.ana} and circle_id = ${circle.circleId}`);
    expect(await credit(circle.circleId, visit.shiftId)).toBe("not_creditable");
    expect(await rows(circle.circleId, "select state from shifts where id = $1", [visit.shiftId])).toEqual([{ state: "confirmed" }]);
    expect(await credit(circle.circleId, randomUUID())).toBe("not_creditable");
  });

  it("queues nothing for a parent's visit or an aide's paid shift", async () => {
    const circle = await visitorWithCircle(db);
    await confirmedVisit(db, circle, { member: "rose" });
    const aide = await newShift(db, circle);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    await asPerson(db.app, amara, (tx) => checkInShift(tx, { circleId: circle.circleId, shiftId: aide }));
    await asPerson(db.app, amara, (tx) => checkOutShift(tx, { circleId: circle.circleId, shiftId: aide, now: CLOCK }));
    await asPerson(db.app, circle.userId, (tx) => confirmShift(tx, { circleId: circle.circleId, shiftId: aide, now: CLOCK }));
    expect(await rows(circle.circleId, "select state from shifts where id = $1", [aide])).toEqual([{ state: "priced" }]);
    expect(await rows(circle.circleId, "select count(*)::int as n from outbox where topic = $1 and circle_id = $2", [SHIFT_CREDIT_TOPIC, circle.circleId])).toEqual([{ n: 0 }]);
  });

  it("never credits a shift that is not confirmed", async () => {
    const circle = await visitorWithCircle(db);
    const planned = await newShift(db, circle, { kind: "visit", member: "ana" });
    expect(await credit(circle.circleId, planned)).toBe("not_creditable");
    expect(await rows(circle.circleId, "select count(*)::int as n from care_entries where shift_id = $1", [planned])).toEqual([{ n: 0 }]);
  });
});

describe("what a credit can never be", () => {
  it("is never more minutes than were worked, and is one entry per visit, whatever the length of the visit", async () => {
    const circle = await visitorWithCircle(db);
    const ends = ["2026-10-30T18:01:00Z", "2026-10-30T18:59:00Z", "2026-10-30T22:30:00Z", "2026-10-31T17:00:00Z"];
    const worked = new Map<string, number>();
    for (const endsAt of ends) {
      const visit = await confirmedVisit(db, circle, { endsAt });
      worked.set(visit.shiftId, visit.minutes);
      expect(await credit(circle.circleId, visit.shiftId)).toBe("credited");
      expect(await credit(circle.circleId, visit.shiftId)).toBe("already_credited");
    }
    const entries = await rows(
      circle.circleId,
      "select c.shift_id, c.minutes, floor(extract(epoch from (s.checked_out_at - s.checked_in_at)) / 60)::int as worked from care_entries c join shifts s on s.id = c.shift_id where c.shift_id is not null",
    );
    expect(entries).toHaveLength(ends.length);
    for (const row of entries) {
      expect(row["minutes"]).toBeLessThanOrEqual(Number(row["worked"]));
      expect(row["minutes"]).toBe(worked.get(String(row["shift_id"])));
    }
    expect(await rows(circle.circleId, "select count(distinct shift_id)::int as shifts, count(*)::int as entries from care_entries where shift_id is not null")).toEqual([{ shifts: ends.length, entries: ends.length }]);
  });
});
