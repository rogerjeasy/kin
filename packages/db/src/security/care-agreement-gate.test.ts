import { priceShift } from "@kin/domain";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { configureCaregiver } from "../caregiver-billing.ts";
import { proposeCareAgreement, signCareAgreement } from "../care-agreements.ts";
import { checkInShift, checkOutShift, settleShift } from "../shifts.ts";
import { asPerson } from "../scope.ts";
import { seatPerson, visitorWithCircle } from "../testing/index.ts";
import { testDatabases } from "../testing/databases.ts";
import { reasonOf } from "../testing/real-shifts.ts";
import { CLOCK, newShift } from "../testing/shifts.ts";

const db = testDatabases();
const person = <T>(userId: string, work: Parameters<typeof asPerson<T>>[2]) => asPerson(db.app, userId, work);

async function confirmedToday(circle: Awaited<ReturnType<typeof visitorWithCircle>>, amara: string): Promise<string> {
  const { circleId } = circle;
  const shiftId = await newShift(db, circle);
  await person(amara, (tx) => checkInShift(tx, { circleId, shiftId }));
  await person(amara, (tx) => checkOutShift(tx, { circleId, shiftId, now: CLOCK }));
  await person(circle.userId, (tx) => tx.execute(sql`select kin_private.confirm_shift(${circleId}::uuid, ${shiftId}::uuid)`));
  return shiftId;
}

describe("the care agreement gate on a shift's pay", () => {
  it("pays a visit the signed agreement covers", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const shiftId = await confirmedToday(circle, amara);
    expect(await reasonOf(person(circle.userId, (tx) => settleShift(tx, { circleId: circle.circleId, shiftId })))).toBe("no error");
  });

  it("holds a visit dated before the agreement's first covered day, leaving the shift confirmed", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const shiftId = await confirmedToday(circle, amara);
    // The agreement now starts after the visit; the trigger that fixes terms is stepped around for this test only.
    await db.admin.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`update care_agreements set starts_on = '2026-11-15' where circle_id = ${circle.circleId}`);
      await tx.execute(sql`update care_agreement_signatures set signed_on = '2026-11-15' where circle_id = ${circle.circleId}`);
    });
    expect(await reasonOf(person(circle.userId, (tx) => settleShift(tx, { circleId: circle.circleId, shiftId })))).toBe("care_agreement");
    expect((await db.admin.execute(sql`select 1 from shifts where id = ${shiftId} and state = 'confirmed' and proposal_id is null`)).rows).toHaveLength(1);
  });

  it("holds a visit at a pay rate the signed agreement does not state, and pays it once an agreement at that rate is signed", async () => {
    const circle = await visitorWithCircle(db);
    const { circleId } = circle;
    const amara = await seatPerson(db, circleId, circle.members.amara);
    await person(circle.userId, (tx) => configureCaregiver(tx, { circleId, memberId: circle.members.amara, payeeId: circle.payees.amara, name: "Amara", rateCentsPerHour: 3000 }));
    const shiftId = await confirmedToday(circle, amara);
    expect(await reasonOf(person(circle.userId, (tx) => settleShift(tx, { circleId, shiftId })))).toBe("care_agreement");
    expect((await db.admin.execute(sql`select 1 from shifts where id = ${shiftId} and state = 'confirmed' and proposal_id is null`)).rows).toHaveLength(1);

    const agreementId = await person(circle.userId, (tx) =>
      proposeCareAgreement(tx, {
        circleId,
        terms: { payeeId: circle.payees.amara, caregiverMemberId: circle.members.amara, caregiverRelation: "not_related", duties: ["Help with meals"], weeklyMinutes: 600, rateCentsPerHour: 3000, startsOn: "2026-10-30", endTerm: "either_party_30_days", endsOn: null, payer: "family_members", state: "NY" },
      }),
    );
    await person(amara, (tx) => signCareAgreement(tx, { circleId, agreementId }));
    await person(circle.userId, (tx) => signCareAgreement(tx, { circleId, agreementId }));
    expect(await reasonOf(person(circle.userId, (tx) => settleShift(tx, { circleId, shiftId })))).toBe("no error");
    const [paid] = (
      await db.admin.execute<{ cents: string; checked_in_at: Date; checked_out_at: Date; minimum: number; after: number | null; percent: number }>(
        sql`select p.cents, s.checked_in_at, s.checked_out_at, y.shift_minimum_minutes as minimum, y.shift_overtime_after_minutes as after, y.shift_overtime_percent as percent
          from shifts s join proposals p on p.id = s.proposal_id join payees y on y.id = s.payee_id where s.id = ${shiftId}`,
      )
    ).rows;
    if (!paid) throw new Error("The shift raised no payment");
    // Priced at the rate the new agreement states.
    const expected = priceShift(new Date(paid.checked_in_at), new Date(paid.checked_out_at), { rateCentsPerHour: 3000, minimumMinutes: paid.minimum, overtimeAfterMinutes: paid.after, overtimePercent: paid.percent });
    expect(Number(paid.cents)).toBe(expected.cents);
  });
});
