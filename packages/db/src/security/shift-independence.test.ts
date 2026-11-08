import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { hashCheckToken, mintCheckLink, newCheckToken, useCheckLink } from "../check-links.ts";
import { asPerson } from "../scope.ts";
import { confirmShift } from "../shifts.ts";
import { seatPerson, visitorWithCircle } from "../testing/index.ts";
import { testDatabases } from "../testing/databases.ts";
import { openAideShift, realCircle, reasonOf } from "../testing/real-shifts.ts";
import { CLOCK, newShift } from "../testing/shifts.ts";

const db = testDatabases();
const HOUR = 60 * 60 * 1000;

/** A member of the family makes a check-in link for a shift, and returns the token. */
async function mint(userId: string, circleId: string, shiftId: string, expiresAt = new Date(Date.now() + 5 * HOUR)): Promise<string> {
  const token = newCheckToken();
  await asPerson(db.app, userId, (tx) => mintCheckLink(tx, { circleId, shiftId, tokenHash: hashCheckToken(token), expiresAt }));
  return token;
}

const word = (userId: string, circleId: string, shiftId: string) => reasonOf(asPerson(db.app, userId, (tx) => confirmShift(tx, { circleId, shiftId, now: new Date() })));

describe("the two keys of a shift stay independent, whoever holds a check-in link (migration 0038)", () => {
  it("refuses the family's word from the member who made a link that was used for the visit, and takes it from another", async () => {
    const circle = await realCircle(db);
    const { circleId } = circle;
    // The parent leaves the decisions to the family, so an organizer's word counts in a real circle.
    await db.admin.execute(sql`update members set parent_level = 'informed' where circle_id = ${circleId} and role = 'parent'`);
    const shiftId = await openAideShift(db, circle);

    const token = await mint(circle.userId, circleId, shiftId);
    await useCheckLink(db.app, { token, action: "out" });

    // The organizer made the link the caregiver's tap came through: not the organizer's word.
    expect(await word(circle.userId, circleId, shiftId)).toBe("own_shift");
    expect((await db.admin.execute(sql`select family_confirmed_at from shifts where id = ${shiftId}`)).rows).toEqual([{ family_confirmed_at: null }]);
    // Another member of the family, who made no link, gives it.
    expect(await word(circle.rose, circleId, shiftId)).toBe("no error");
    expect((await db.admin.execute(sql`select state, family_confirmed_by from shifts where id = ${shiftId}`)).rows).toEqual([{ state: "priced", family_confirmed_by: circle.members.rose }]);
  });

  it("refuses a link's use when the member who made it has already given the word, so they cannot tap as the caregiver afterwards", async () => {
    const circle = await realCircle(db);
    const { circleId } = circle;
    await db.admin.execute(sql`update members set parent_level = 'informed' where circle_id = ${circleId} and role = 'parent'`);
    const shiftId = await openAideShift(db, circle);
    const token = await mint(circle.userId, circleId, shiftId);
    // Made and unused: no tap has come through it, so the word is still the organizer's to give.
    expect(await word(circle.userId, circleId, shiftId)).toBe("no error");
    // But the link they made can no longer turn the caregiver's key: that would be both keys by one person.
    await expect(useCheckLink(db.app, { token, action: "out" })).rejects.toMatchObject({ reason: "own_shift" });
    expect((await db.admin.execute(sql`select checked_out_at, uses from shifts s join shift_check_links l on l.shift_id = s.id where s.id = ${shiftId}`)).rows).toEqual([{ checked_out_at: null, uses: 0 }]);
    // A link made by someone else still works, and the caregiver's own session always could.
    const other = await mint(circle.rose, circleId, shiftId);
    await expect(useCheckLink(db.app, { token: other, action: "out" })).resolves.toMatchObject({ turned: true });
  });

  it("refuses a link to a member who has already given the family's word for the shift", async () => {
    const circle = await realCircle(db);
    const { circleId } = circle;
    await db.admin.execute(sql`update members set parent_level = 'informed' where circle_id = ${circleId} and role = 'parent'`);
    const shiftId = await openAideShift(db, circle);
    expect(await word(circle.userId, circleId, shiftId)).toBe("no error");
    expect(await reasonOf(mint(circle.userId, circleId, shiftId))).toBe("own_shift");
    // The parent made no word, so the parent may make the caregiver's link.
    await expect(mint(circle.rose, circleId, shiftId)).resolves.toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("covers the parent too: her word is refused for a visit she tapped through her own link", async () => {
    const circle = await realCircle(db);
    const { circleId } = circle;
    const shiftId = await openAideShift(db, circle);
    const token = await mint(circle.rose, circleId, shiftId);
    await useCheckLink(db.app, { token, action: "out" });
    expect(await word(circle.rose, circleId, shiftId)).toBe("own_shift");
  });

  it("does not bind a demo circle, where one visitor plays every role and the money is simulated", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    expect(amara).toBeTruthy();
    const shiftId = await newShift(db, circle);
    const token = await mint(circle.userId, circle.circleId, shiftId, new Date(CLOCK.getTime() + HOUR));
    await useCheckLink(db.app, { token, action: "in" });
    await useCheckLink(db.app, { token, action: "out" });
    expect(await word(circle.userId, circle.circleId, shiftId)).toBe("no error");
  });
});
