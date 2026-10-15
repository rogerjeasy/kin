import { describe, expect, it } from "vitest";

import { leaveDemoCircle, membershipsOf } from "../people.ts";
import { CircleNotFoundError, readCircle } from "../read-circle.ts";
import { asPerson } from "../scope.ts";
import { seatPerson, visitorWithCircle } from "../testing/circles.ts";
import { createDemoVisitor } from "../people.ts";
import { testDatabases } from "../testing/databases.ts";
import { REFUSED, errorCode } from "../testing/sql.ts";
import { provisionDemoCircle } from "./provision.ts";

const db = testDatabases();

describe("a visitor's demo seat", () => {
  it("is one at a time: a second circle for the same person is refused", async () => {
    const userId = await createDemoVisitor(db.app);
    await provisionDemoCircle(db.provisioner, userId);
    expect(await errorCode(provisionDemoCircle(db.provisioner, userId))).toBe(REFUSED.unique);
    expect(await asPerson(db.app, userId, (tx) => membershipsOf(tx, userId))).toHaveLength(1);
  });

  it("is listed as the person's circle, in the organizer's role", async () => {
    const circle = await visitorWithCircle(db);
    expect(await asPerson(db.app, circle.userId, (tx) => membershipsOf(tx, circle.userId))).toEqual([
      { circleId: circle.circleId, circleName: "Rose's circle", memberId: circle.members.elena, role: "organizer", demo: true, demoSeat: true },
    ]);
  });

  it("can be given up to start again: the old circle is archived, kept, and no longer opens", async () => {
    const first = await visitorWithCircle(db);
    await asPerson(db.app, first.userId, (tx) => leaveDemoCircle(tx, first.circleId));
    expect(await asPerson(db.app, first.userId, (tx) => membershipsOf(tx, first.userId))).toEqual([]);
    await expect(
      asPerson(db.app, first.userId, (tx) => readCircle(tx, { circleId: first.circleId, userId: first.userId, now: new Date() })),
    ).rejects.toThrow(CircleNotFoundError);

    const second = await provisionDemoCircle(db.provisioner, first.userId);
    const [membership] = await asPerson(db.app, first.userId, (tx) => membershipsOf(tx, first.userId));
    expect(membership?.circleId).toBe(second.circleId);
  });

  it("is the only seat a person can give up this way", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    expect(await errorCode(asPerson(db.app, mine.userId, (tx) => leaveDemoCircle(tx, theirs.circleId)))).toBe(REFUSED.permission);
    const amara = await seatPerson(db, mine.circleId, mine.members.amara);
    expect(await errorCode(asPerson(db.app, amara, (tx) => leaveDemoCircle(tx, mine.circleId)))).toBe(REFUSED.permission);
    expect(await asPerson(db.app, mine.userId, (tx) => membershipsOf(tx, mine.userId))).toHaveLength(1);
  });
});
