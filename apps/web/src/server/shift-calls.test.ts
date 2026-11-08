import { asPerson, readCircle, type CircleSnapshot } from "@kin/db";
import { seatPerson, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { describe, expect, it, vi } from "vitest";

import { testDatabases } from "../../../../packages/db/src/testing/databases.ts";
import { runShift, type ShiftContext, type ShiftResult } from "./shifts";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");
const PHONE = "+14155550123";

const snapshot = (circle: VisitorCircle, userId: string): Promise<CircleSnapshot> => asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: CLOCK }));

/** Runs one operation as a persona of the circle, on a snapshot read just before. */
async function as(circle: VisitorCircle, persona: keyof VisitorCircle["members"], input: unknown, change?: (seen: CircleSnapshot) => CircleSnapshot): Promise<ShiftResult> {
  const userId = persona === "elena" ? circle.userId : await seatPerson(db, circle.circleId, circle.members[persona]);
  const seen = await snapshot(circle, userId);
  const context: ShiftContext = { db: db.app, userId, circle: change ? change(seen) : seen };
  return runShift(context, input);
}

async function todaysShift(circle: VisitorCircle): Promise<string> {
  const seen = await snapshot(circle, circle.userId);
  const found = seen.shifts.find((shift) => shift.kind === "aide" && shift.state === "scheduled" && shift.startsAt.toISOString() === "2026-10-30T14:00:00.000Z");
  if (!found) throw new Error("The demo has no aide shift today");
  return found.id;
}

const settingsAs = async (circle: VisitorCircle, persona: keyof VisitorCircle["members"]) => (await snapshot(circle, persona === "elena" ? circle.userId : await seatPerson(db, circle.circleId, circle.members[persona]))).parentCallSettings;
const switchedOn = { operation: "call_settings", enabled: true, phone: PHONE, consent: true };
const demoOff = (seen: CircleSnapshot): CircleSnapshot => ({ ...seen, circle: { ...seen.circle, demo: false } });

describe("who may switch Kin's call to the parent on or off, refused first", () => {
  it("refuses an observer and a caregiver both ways, and a contributor the switching on", async () => {
    const circle = await visitorWithCircle(db);
    for (const persona of ["daniel", "amara"] as const) {
      expect(await as(circle, persona, switchedOn), persona).toEqual({ ok: false, reason: "refused" });
      expect(await as(circle, persona, { operation: "call_settings", enabled: false }), persona).toEqual({ ok: false, reason: "refused" });
    }
    expect(await as(circle, "marcus", switchedOn)).toEqual({ ok: false, reason: "refused" });
    expect(await settingsAs(circle, "elena")).toBeNull();
  });

  it("refuses an organizer in a real circle, where only the parent says yes to a call to herself", async () => {
    const circle = await visitorWithCircle(db);
    expect(await as(circle, "elena", switchedOn, demoOff)).toEqual({ ok: false, reason: "refused" });
    expect(await settingsAs(circle, "elena")).toBeNull();
  });
});

describe("switching the call on and off", () => {
  it("needs the parent's agreement and a number Kin can dial, and says which is missing", async () => {
    const circle = await visitorWithCircle(db);
    expect(await as(circle, "rose", { ...switchedOn, consent: false })).toEqual({ ok: false, reason: "consent_needed" });
    expect(await as(circle, "rose", { operation: "call_settings", enabled: true, phone: PHONE })).toEqual({ ok: false, reason: "consent_needed" });
    for (const phone of ["", "4155550123", "+0155550123", "+1", 14155550123, null]) {
      expect(await as(circle, "rose", { ...switchedOn, phone }), String(phone)).toEqual({ ok: false, reason: "bad_phone" });
    }
    for (const input of [{ ...switchedOn, extra: 1 }, { operation: "call_settings" }, { operation: "call_settings", enabled: "yes" }, { operation: "call_settings", enabled: false, phone: PHONE }]) {
      expect(await as(circle, "rose", input), JSON.stringify(input)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await settingsAs(circle, "rose")).toBeNull();
  });

  it("records who agreed and when, answers without the number, and lets a contributor switch it off", async () => {
    const circle = await visitorWithCircle(db);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await as(circle, "rose", { ...switchedOn, phone: "+1 (415) 555-0123" });
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).not.toContain("4155550123");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("4155550123");

    const seen = await settingsAs(circle, "rose");
    expect(seen).toMatchObject({ enabled: true, consentedBy: circle.members.rose });
    expect(seen?.consentedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(seen)).not.toContain("4155550123");
    // A contributor is not shown the settings, but may stop the call.
    expect(await settingsAs(circle, "marcus")).toBeNull();
    expect(await as(circle, "marcus", { operation: "call_settings", enabled: false })).toMatchObject({ ok: true });
    expect(await settingsAs(circle, "elena")).toMatchObject({ enabled: false });
  });

  it("lets the organizer play the parent in a demo circle", async () => {
    const circle = await visitorWithCircle(db);
    expect(await as(circle, "elena", switchedOn)).toMatchObject({ ok: true });
    expect(await settingsAs(circle, "elena")).toMatchObject({ enabled: true, memberId: circle.members.rose });
  });
});

describe("Kin's call, played in a demo circle", () => {
  async function finishedVisit(circle: VisitorCircle): Promise<string> {
    const shiftId = await todaysShift(circle);
    await as(circle, "amara", { operation: "check_in", shiftId });
    await as(circle, "amara", { operation: "check_out", shiftId });
    return shiftId;
  }

  it("is refused to a caregiver and an observer, who never give the family's word", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await finishedVisit(circle);
    for (const persona of ["amara", "daniel"] as const) {
      expect(await as(circle, persona, { operation: "call_script", shiftId, locale: "en" }), persona).toEqual({ ok: false, reason: "refused" });
    }
  });

  it("plays the sentences of the real call from the record, in the language asked for", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await finishedVisit(circle);
    const english = await as(circle, "rose", { operation: "call_script", shiftId, locale: "en" });
    if (!english.ok || !("call" in english)) throw new Error("Expected the call");
    expect(english.call.opening[0]).toContain("Kin");
    expect(english.call.question).toContain("Amara");
    expect(english.call.question).toContain("this morning");
    expect(english.call.question).toMatch(/press 1/i);
    const french = await as(circle, "rose", { operation: "call_script", shiftId, locale: "fr" });
    expect(french).toMatchObject({ ok: true, call: { question: expect.stringContaining("ce matin") } });
  });

  it("is not played for a real circle, a visit that has not ended, or a shift Kin cannot find", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await todaysShift(circle);
    const ask = (input: Record<string, unknown>, change?: (seen: CircleSnapshot) => CircleSnapshot) => as(circle, "rose", { operation: "call_script", locale: "en", ...input }, change);
    expect(await ask({ shiftId })).toEqual({ ok: false, reason: "wrong_state" });
    await as(circle, "amara", { operation: "check_in", shiftId });
    await as(circle, "amara", { operation: "check_out", shiftId });
    expect(await ask({ shiftId }, demoOff)).toEqual({ ok: false, reason: "refused" });
    expect(await ask({ shiftId: "00000000-0000-4000-8000-000000000000" })).toEqual({ ok: false, reason: "refused" });
    expect(await ask({ shiftId: "nope" })).toEqual({ ok: false, reason: "invalid" });
    expect(await ask({ shiftId, locale: "xx" })).toEqual({ ok: false, reason: "invalid" });
  });
});
