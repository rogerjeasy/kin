import { describe, expect, it } from "vitest";

import { readPurseSpendingAllowed } from "../purse.ts";
import { asPerson } from "../scope.ts";
import { seatPerson, visitorWithCircle, type VisitorCircle } from "../testing/index.ts";
import { testDatabases } from "../testing/databases.ts";
import { attestWishTrigger, readDiscretionaryPause } from "../wishes.ts";

const db = testDatabases();

const attest = (userId: string, circle: VisitorCircle, stance: "start" | "end") =>
  asPerson(db.app, userId, (tx) => attestWishTrigger(tx, { circleId: circle.circleId, event: "hospital", stance }));

/** The Purse's one gate, and the wishes' own answer, read in the same moment as the parent. */
const gates = (userId: string, circle: VisitorCircle) =>
  asPerson(db.app, userId, async (tx) => ({ purseOpen: await readPurseSpendingAllowed(tx, circle.circleId), paused: (await readDiscretionaryPause(tx, circle.circleId)).paused }));

describe("the parent's Purse under her own wishes", () => {
  it("closes while a trigger her pause wish applies to is active, and opens again when she is home", async () => {
    const circle = await visitorWithCircle(db);
    const rose = (await seatPerson(db, circle.circleId, circle.members.rose)) as string;
    const marcus = (await seatPerson(db, circle.circleId, circle.members.marcus)) as string;

    expect(await gates(rose, circle)).toEqual({ purseOpen: true, paused: false });

    // One report is not enough: nothing changes yet.
    await attest(circle.userId, circle, "start");
    expect(await gates(rose, circle)).toEqual({ purseOpen: true, paused: false });

    // A second person makes it active; her wish "don't buy her things while she's away" now applies.
    await attest(marcus, circle, "start");
    expect(await gates(rose, circle)).toEqual({ purseOpen: false, paused: true });

    await attest(circle.userId, circle, "end");
    await attest(marcus, circle, "end");
    expect(await gates(rose, circle)).toEqual({ purseOpen: true, paused: false });
  });
});
