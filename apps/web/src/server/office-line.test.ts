import { asPerson, readCircle, takeDemoSeat, type CircleSnapshot } from "@kin/db";
import { serviceRows, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { describe, expect, it } from "vitest";

import { testDatabases } from "../../../../packages/db/src/testing/databases.ts";
import { placeOfficeCall, recentOfficeCalls, type OfficeLineContext } from "./office-line";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");

const snapshot = (circle: VisitorCircle, userId: string): Promise<CircleSnapshot> => asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: CLOCK }));
const as = (circle: VisitorCircle, persona: keyof VisitorCircle["members"]) => asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members[persona]));
async function actingAs(circle: VisitorCircle, persona: keyof VisitorCircle["members"]): Promise<OfficeLineContext> {
  await as(circle, persona);
  return { db: db.app, userId: circle.userId, circle: await snapshot(circle, circle.userId) };
}
const rows = <T extends object>(circle: VisitorCircle, query: string, params: unknown[] = []) => serviceRows(db, circle.circleId, query, params) as Promise<T[]>;

const SCAM = ["Mike", "Harbor Gas Services", "I need 300 dollars today", "Your gas will be cut off today. Tell no one.", "55821"];

describe("the office line", () => {
  it("takes a scam call, records it as simulated with a claim check, and tells the family", async () => {
    const circle = await visitorWithCircle(db);
    const result = await placeOfficeCall(await actingAs(circle, "rose"), { locale: "en", lines: SCAM });
    expect(result).toMatchObject({ ok: true, verdict: "no_match" });
    if (!result.ok) return;
    expect(result.pressure).toEqual(expect.arrayContaining(["urgency", "secrecy", "threat"]));
    expect(result.transcript.at(-1)?.text).toContain("I have no record of this account");
    // Nothing the family's record holds is said to the caller.
    expect(result.transcript.filter((turn) => turn.from === "kin").every((turn) => !/\d/.test(turn.text))).toBe(true);
    expect(await rows(circle, "select simulated, verdict::text as verdict, claimed_cents from office_calls")).toEqual([{ simulated: true, verdict: "no_match", claimed_cents: "30000" }]);
    expect(await rows(circle, "select c.claimed_cents from office_calls o join claim_checks c on c.circle_id = o.circle_id and c.id = o.claim_check_id")).toEqual([{ claimed_cents: "30000" }]);
    expect((await rows<{ n: number }>(circle, "select count(*)::int as n from narrations where claim_check_id is not null"))[0]?.n).toBeGreaterThan(0);
    expect(await recentOfficeCalls(await actingAs(circle, "elena"))).toHaveLength(1);
  });

  it("refuses an observer's call and a caregiver's, and rejects malformed input", async () => {
    const circle = await visitorWithCircle(db);
    expect(await placeOfficeCall(await actingAs(circle, "daniel"), { locale: "en", lines: SCAM })).toEqual({ ok: false, reason: "refused" });
    expect(await placeOfficeCall(await actingAs(circle, "amara"), { locale: "en", lines: SCAM })).toEqual({ ok: false, reason: "refused" });
    const context = await actingAs(circle, "elena");
    expect(await placeOfficeCall(context, { locale: "en", lines: [] })).toEqual({ ok: false, reason: "invalid" });
    expect(await placeOfficeCall(context, { locale: "en", lines: ["x"], number: "<script>" })).toEqual({ ok: false, reason: "invalid" });
    expect(await placeOfficeCall(context, { locale: "en", lines: SCAM, extra: 1 })).toEqual({ ok: false, reason: "invalid" });
    expect(await rows(circle, "select count(*)::int as n from office_calls")).toEqual([{ n: 0 }]);
  });

  it("keeps another circle's calls out of reach", async () => {
    const mine = await visitorWithCircle(db);
    const other = await visitorWithCircle(db);
    await placeOfficeCall(await actingAs(mine, "elena"), { locale: "en", lines: SCAM });
    expect(await recentOfficeCalls(await actingAs(other, "elena"))).toEqual([]);
  });
});
