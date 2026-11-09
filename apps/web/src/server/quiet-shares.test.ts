import { fakeModel } from "@kin/agent/testing";
import { asPerson, takeDemoSeat, type CircleSnapshot } from "@kin/db";
import { snapshotFor, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { fakePool } from "@kin/paypal/testing";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { familySeats, quietShareViews, readMyWords, runQuietShare, type QuietContext } from "./quiet-shares";

const db = testDatabases();
const services = { pool: fakePool(), returnUrl: "https://kin.test/dashboard/fairness/quiet-shares" };
const draft = (monthly: string) => ({ monthly, stepUp: "", stepUpMonth: "", earliestMonth: "", careTrips: "", careHours: "" });
const spend = () => true;

/** A demo visitor in `persona`'s seat of a fresh demo circle; Elena, the organizer, unless another is named. */
async function demoAs(persona: keyof VisitorCircle["members"] = "elena"): Promise<{ context: QuietContext; visitor: VisitorCircle; reload: () => Promise<CircleSnapshot> }> {
  const visitor = await visitorWithCircle(db);
  if (persona !== "elena") await asPerson(db.app, visitor.userId, (tx) => takeDemoSeat(tx, visitor.circleId, visitor.members[persona]));
  const circle = await snapshotFor(db, visitor.userId, visitor.circleId);
  return { context: { db: db.app, userId: visitor.userId, circle }, visitor, reload: () => snapshotFor(db, visitor.userId, visitor.circleId) };
}

const stairliftOf = async (context: QuietContext) => {
  const [ask] = await quietShareViews(context);
  if (!ask) throw new Error("No ask");
  return ask;
};

describe("quiet shares at the request boundary", () => {
  it("plays the demo's family from the organizer's seat: each phone acts in its own seat, and the visitor keeps theirs", async () => {
    const { context, visitor, reload } = await demoAs();
    const ask = await stairliftOf(context);
    const model = fakeModel({ kind: "json", text: JSON.stringify({ monthly: "600", stepUpAmount: null, stepUpMonth: null, earliestMonth: null, careTrips: null, careHours: null, reply: "Thank you." }) });
    const words = await readMyWords(context, model, { operation: "words", askId: ask.id, messages: ["I can cover more this time, up to 600."], seat: visitor.members.marcus, locale: "en" }, "en", spend);
    expect(words).toEqual({ ok: true, draft: draft("600.00"), reply: "Thank you.", heardAmount: true });

    expect(await runQuietShare(context, services, { operation: "seal", askId: ask.id, offer: draft("600"), seat: visitor.members.marcus })).toEqual({ ok: true, state: "gathering" });
    expect(await runQuietShare(context, services, { operation: "seal", askId: ask.id, offer: { ...draft("60"), careTrips: "2", careHours: "3" }, seat: visitor.members.ana })).toEqual({ ok: true, state: "planned" });

    const seats = await familySeats({ ...context, circle: await reload() });
    expect(seats?.map((seat) => [seat.name, seat.asks[0]?.myPart?.cents, seat.asks[0]?.myPart?.atLimit])).toEqual([
      ["Marcus", 54_000, false],
      ["Elena", 30_000, false],
      ["Ana", 6_000, true],
    ]);
    expect(seats?.find((seat) => seat.name === "Ana")?.asks[0]?.myOffer).toMatchObject({ monthlyCents: 6_000, careTrips: 2, careMinutes: 180 });
    // The visitor is Elena again, and reads only her own offer and part.
    const mine = await stairliftOf({ ...context, circle: await reload() });
    expect(mine.myOffer?.monthlyCents).toBe(30_000);
    expect((await reload()).viewer.memberId).toBe(visitor.members.elena);
  });

  it("refuses a seat that is not a member, and refuses an observer every change and every word to an agent", async () => {
    const { context } = await demoAs();
    const ask = await stairliftOf(context);
    expect(await runQuietShare(context, services, { operation: "seal", askId: ask.id, offer: draft("1"), seat: randomUUID() })).toEqual({ ok: false, reason: "refused" });

    const observer = (await demoAs("daniel")).context;
    const theirs = await stairliftOf(observer);
    expect(theirs.myOffer).toBeNull();
    for (const input of [
      { operation: "seal", askId: theirs.id, offer: draft("1") },
      { operation: "accept", askId: theirs.id, method: "checkout" },
      { operation: "take_gap", askId: theirs.id },
      { operation: "raise", title: "x", kind: "one_off", amount: "10" },
      { operation: "withdraw", askId: theirs.id },
    ]) {
      expect(await runQuietShare(observer, services, input)).toEqual({ ok: false, reason: "refused" });
    }
    const never = fakeModel();
    expect(await readMyWords(observer, never, { operation: "words", askId: theirs.id, messages: ["60"], locale: "en" }, "en", spend)).toEqual({ ok: false, reason: "refused" });
    expect(never.requests).toHaveLength(0);
    // A caregiver is not shown the asks at all.
    expect(await quietShareViews((await demoAs("amara")).context)).toEqual([]);
  });

  it("reads the confirmed offer digit by digit and refuses what is not one", async () => {
    const { context } = await demoAs("ana");
    const ask = await stairliftOf(context);
    for (const offer of [draft("60.5.5"), draft("-60"), { ...draft("60"), stepUp: "150" }, { ...draft("60"), careTrips: "two" }, { ...draft("60"), earliestMonth: "2020-01" }, { ...draft("60"), extra: "1" }]) {
      expect(await runQuietShare(context, services, { operation: "seal", askId: ask.id, offer })).toEqual({ ok: false, reason: "invalid" });
    }
    expect((await stairliftOf(context)).myOffer).toBeNull();
  });

  it("asks the model only while a use is left, and never without a model", async () => {
    const { context } = await demoAs("ana");
    const ask = await stairliftOf(context);
    const never = fakeModel();
    expect(await readMyWords(context, never, { operation: "words", askId: ask.id, messages: ["60"], locale: "en" }, "en", () => false)).toEqual({ ok: false, reason: "limit" });
    expect(await readMyWords(context, null, { operation: "words", askId: ask.id, messages: ["60"], locale: "en" }, "en", spend)).toEqual({ ok: false, reason: "unavailable" });
    expect(never.requests).toHaveLength(0);
  });
});
