import { ModelUnavailableError } from "@kin/agent";
import { fakeModel, visitsReply } from "@kin/agent/testing";
import { asPerson, readCircle, takeDemoSeat, type CircleSnapshot } from "@kin/db";
import { addMember, seatPerson, serviceRows, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { describe, expect, it } from "vitest";

import { testDatabases } from "../../../../packages/db/src/testing/databases.ts";
import { createRateLimiter } from "./model";
import { previewVisits } from "./visit-preview";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");
const SAMPLE = "Monday 4 hours and Tuesday from 9 to 11.";
const reply = visitsReply([
  { date: "2026-10-26", hours: 4, minutes: 0, quote: "Monday 4 hours" },
  { date: "2026-10-27", hours: 2, minutes: 0, quote: "Tuesday from 9 to 11" },
]);

const snapshot = (circle: VisitorCircle, userId: string): Promise<CircleSnapshot> => asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: CLOCK }));
async function asOrganizer(circle: VisitorCircle, extra: object = {}) {
  await asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members.elena));
  return { db: db.app, userId: circle.userId, circle: await snapshot(circle, circle.userId), accountTypes: "demo" as const, ...extra };
}
const count = (circle: VisitorCircle, table: string) => serviceRows(db, circle.circleId, `select count(*)::int as n from ${table}`, []);

describe("the preview of how a caregiver bills", () => {
  it("shows the days Kin read, with the words each came from and who read them, and records nothing", async () => {
    const circle = await visitorWithCircle(db);
    const model = fakeModel(reply);
    const before = await count(circle, "bills");
    const result = await previewVisits(await asOrganizer(circle, { model }), { description: SAMPLE });
    expect(result).toEqual({
      ok: true,
      described: true,
      visits: [{ date: "2026-10-26", minutes: 240, quotes: ["Monday 4 hours"] }, { date: "2026-10-27", minutes: 120, quotes: ["Tuesday from 9 to 11"] }],
      unclear: [],
      dropped: 0,
      provenance: { source: "claude", model: "fake-model" },
    });
    expect(await count(circle, "bills")).toEqual(before);
    // Only the description is sent: no rate, no name, no money reaches the model.
    const asked = `${model.requests[0]?.system ?? ""}${model.requests[0]?.user ?? ""}`;
    for (const leak of ["2200", "22.00", "$", "Amara"]) expect(asked).not.toContain(leak);
  });

  it("is refused for a caregiver and an observer, and for any circle that is not a demo", async () => {
    const circle = await visitorWithCircle(db);
    const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
    const observer = await addMember(db, circle.circleId, "observer");
    for (const person of [caregiver, observer.userId]) {
      const context = { db: db.app, userId: person, circle: await snapshot(circle, person), accountTypes: "demo" as const, model: fakeModel(reply) };
      expect(await previewVisits(context, { description: SAMPLE })).toEqual({ ok: false, reason: "refused" });
    }
    const organizer = await asOrganizer(circle, { model: fakeModel(reply) });
    const real = { ...organizer, circle: { ...organizer.circle, circle: { ...organizer.circle.circle, demo: false } } };
    expect(await previewVisits(real, { description: SAMPLE })).toEqual({ ok: false, reason: "refused" });
  });

  it("refuses anything but a description, so nothing else can ride along", async () => {
    const circle = await visitorWithCircle(db);
    const context = await asOrganizer(circle, { model: fakeModel(reply) });
    for (const bad of [null, [], {}, { description: 4 }, { description: SAMPLE, rate: "22.00" }, { description: SAMPLE, operation: "submit" }]) {
      expect(await previewVisits(context, bad)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("uses the same limits as the caregiver's own reading, and says why when the model is not used", async () => {
    const circle = await visitorWithCircle(db);
    const limiter = createRateLimiter(1, 60_000);
    const context = await asOrganizer(circle, { model: fakeModel(reply, reply), limiter, now: () => 1_000 });
    expect(await previewVisits(context, { description: SAMPLE })).toMatchObject({ ok: true });
    expect(await previewVisits(context, { description: SAMPLE })).toEqual({ ok: false, reason: "busy", why: "limit_reached" });
    expect(await previewVisits({ ...context, model: null }, { description: SAMPLE })).toEqual({ ok: false, reason: "model_unavailable", why: "not_configured" });
    const throttled = await asOrganizer(circle, { model: fakeModel(new ModelUnavailableError("throttled", { kind: "busy" })) });
    expect(await previewVisits(throttled, { description: SAMPLE })).toEqual({ ok: false, reason: "model_unavailable", why: "model_busy" });
  });
});
