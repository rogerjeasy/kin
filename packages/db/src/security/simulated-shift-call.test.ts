import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { answerSimulatedShiftCall, checkInShift, checkOutShift } from "../shifts.ts";
import { asPerson } from "../scope.ts";
import { seatPerson, visitorWithCircle, type VisitorCircle } from "../testing/index.ts";
import { testDatabases } from "../testing/databases.ts";
import { reasonOf, waitingForWord } from "../testing/real-shifts.ts";
import { CLOCK, newShift } from "../testing/shifts.ts";

const db = testDatabases();
const person = <T>(userId: string, work: Parameters<typeof asPerson<T>>[2]) => asPerson(db.app, userId, work);
const answer = (userId: string, circleId: string, shiftId: string, said: "yes" | "no") =>
  person(userId, (tx) => answerSimulatedShiftCall(tx, { circleId, shiftId, answer: said, now: CLOCK }));

/** A demo circle whose aide has just left today's visit, which waits for the family's word. */
async function finishedVisit(): Promise<{ circle: VisitorCircle; amara: string; shiftId: string }> {
  const circle = await visitorWithCircle(db);
  const amara = await seatPerson(db, circle.circleId, circle.members.amara);
  const shiftId = await newShift(db, circle);
  await person(amara, (tx) => checkInShift(tx, { circleId: circle.circleId, shiftId }));
  await person(amara, (tx) => checkOutShift(tx, { circleId: circle.circleId, shiftId, now: CLOCK }));
  return { circle, amara, shiftId };
}

const shiftRow = async (shiftId: string) =>
  (
    await db.admin.execute<{ state: string; family_confirmed_by: string | null; family_confirmation: string | null; proposal_id: string | null }>(
      sql`select state, family_confirmed_by, family_confirmation, proposal_id from shifts where id = ${shiftId}`,
    )
  ).rows[0];
const calls = async (shiftId: string) =>
  (await db.admin.execute<{ attempt: number; state: string }>(sql`select attempt, state from shift_calls where shift_id = ${shiftId} order by attempt`)).rows;

describe("Kin's call answered in a demo circle", () => {
  it("records a yes as the parent's word, never as the person who pressed the key, and pays the visit", async () => {
    const { circle, shiftId } = await finishedVisit();
    // The organizer plays Rose.
    expect(await reasonOf(answer(circle.userId, circle.circleId, shiftId, "yes"))).toBe("no error");
    expect(await shiftRow(shiftId)).toMatchObject({ family_confirmed_by: circle.members.rose, family_confirmation: "parent" });
    expect((await shiftRow(shiftId))?.proposal_id).not.toBeNull();
    expect(await calls(shiftId)).toEqual([{ attempt: 1, state: "confirmed" }]);
    const audited = await db.admin.execute<{ member_id: string; details: { simulated: boolean; parentMemberId: string } }>(
      sql`select member_id, details from audit_log where subject_id = ${shiftId} and action = 'shift.word_by_call'`,
    );
    expect(audited.rows).toEqual([{ member_id: circle.members.elena, details: expect.objectContaining({ simulated: true, parentMemberId: circle.members.rose }) }]);
  });

  it("records a no as a call the parent declined: nothing is confirmed or paid, and the visit still waits for the family", async () => {
    const { circle, shiftId } = await finishedVisit();
    expect(await reasonOf(answer(circle.userId, circle.circleId, shiftId, "no"))).toBe("no error");
    expect(await shiftRow(shiftId)).toEqual({ state: "checked_out", family_confirmed_by: null, family_confirmation: null, proposal_id: null });
    expect(await calls(shiftId)).toEqual([{ attempt: 1, state: "declined" }]);
    const audited = await db.admin.execute(sql`select 1 from audit_log where subject_id = ${shiftId} and action = 'shift.word_declined_by_call'`);
    expect(audited.rows).toHaveLength(1);
  });

  it("calls at most twice for a visit, as a real call does, and not once the word is in", async () => {
    const { circle, shiftId } = await finishedVisit();
    await answer(circle.userId, circle.circleId, shiftId, "no");
    await answer(circle.userId, circle.circleId, shiftId, "no");
    expect(await reasonOf(answer(circle.userId, circle.circleId, shiftId, "yes"))).toBe("wrong_state");
    const other = await finishedVisit();
    await answer(other.circle.userId, other.circle.circleId, other.shiftId, "yes");
    expect(await reasonOf(answer(other.circle.userId, other.circle.circleId, other.shiftId, "no"))).toBe("wrong_state");
  });

  it("refuses the caregiver, an observer, and anyone for their own shift, and leaves no call behind", async () => {
    const { circle, amara, shiftId } = await finishedVisit();
    const daniel = await seatPerson(db, circle.circleId, circle.members.daniel);
    expect(await reasonOf(answer(amara, circle.circleId, shiftId, "yes"))).toBe("refused");
    expect(await reasonOf(answer(daniel, circle.circleId, shiftId, "yes"))).toBe("refused");
    expect(await calls(shiftId)).toEqual([]);
  });

  it("refuses an answer that is neither yes nor no, and a visit that has not ended", async () => {
    const { circle, shiftId } = await finishedVisit();
    expect(await reasonOf(person(circle.userId, (tx) => tx.execute(sql`select kin_private.answer_simulated_shift_call(${circle.circleId}::uuid, ${shiftId}::uuid, 'maybe')`)))).toMatch(/not valid/);
    const open = await visitorWithCircle(db);
    const openAmara = await seatPerson(db, open.circleId, open.members.amara);
    const openShift = await newShift(db, open);
    await person(openAmara, (tx) => checkInShift(tx, { circleId: open.circleId, shiftId: openShift }));
    expect(await reasonOf(answer(open.userId, open.circleId, openShift, "yes"))).toBe("wrong_state");
  });

  it("is refused in a real circle, which gets the real call", async () => {
    const circle = await waitingForWord(db);
    expect(await reasonOf(answer(circle.userId, circle.circleId, circle.shiftId, "yes"))).toBe("refused");
    expect(await reasonOf(answer(circle.rose, circle.circleId, circle.shiftId, "yes"))).toBe("refused");
    expect(await calls(circle.shiftId)).toEqual([]);
  });
});
