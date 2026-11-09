import { asPerson, checkInShift, checkOutShift, readCircle, type CircleSnapshot } from "@kin/db";
import { seatPerson, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { fakeTranscriber, fakeVoice } from "@kin/speech/testing";
import { describe, expect, it } from "vitest";

import { testDatabases } from "../../../../packages/db/src/testing/databases.ts";
import { createRateLimiter } from "./model";
import { sayShiftCall } from "./shift-call-speech";
import type { SpeechContext } from "./speech-actions";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");

const snapshot = (circle: VisitorCircle, userId: string): Promise<CircleSnapshot> => asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: CLOCK }));

async function finishedVisit(): Promise<{ circle: VisitorCircle; shiftId: string }> {
  const circle = await visitorWithCircle(db);
  const amara = await seatPerson(db, circle.circleId, circle.members.amara);
  const found = (await snapshot(circle, amara)).shifts.find((shift) => shift.kind === "aide" && shift.state === "scheduled");
  if (!found) throw new Error("The demo has no aide shift to finish");
  await asPerson(db.app, amara, (tx) => checkInShift(tx, { circleId: circle.circleId, shiftId: found.id }));
  await asPerson(db.app, amara, (tx) => checkOutShift(tx, { circleId: circle.circleId, shiftId: found.id, now: CLOCK }));
  return { circle, shiftId: found.id };
}

async function speech(circle: VisitorCircle, persona: keyof VisitorCircle["members"], change: (seen: CircleSnapshot) => CircleSnapshot = (seen) => seen) {
  const userId = await seatPerson(db, circle.circleId, circle.members[persona]);
  const voice = fakeVoice();
  const context: SpeechContext = {
    db: db.app,
    userId,
    circle: change(await snapshot(circle, userId)),
    accountTypes: "demo",
    services: { transcriber: fakeTranscriber(), voice },
    limiter: createRateLimiter(60, 3_600_000),
    budget: createRateLimiter(600, 3_600_000),
  };
  return { context, voice };
}

describe("Kin reading its simulated call aloud", () => {
  it("speaks the call's own sentences, built from the record, the opening and the question together", async () => {
    const { circle, shiftId } = await finishedVisit();
    const { context, voice } = await speech(circle, "rose");
    expect(await sayShiftCall(context, { shiftId, part: "question", locale: "en" })).toMatchObject({ ok: true, contentType: "audio/mpeg" });
    // Checked in at the demo clock, 2 PM in New York, so the question is about the afternoon.
    expect(voice.said[0]?.text).toBe(
      "This is Kin, an automated assistant for your family. If you did not expect this call, you can hang up. Amara is finishing the visit. Was Amara with you this afternoon? Say yes, or press 1. Say no, or press 2.",
    );
    await sayShiftCall(context, { shiftId, part: "confirmed", locale: "en" });
    expect(voice.said[1]?.text).toBe("Thank you. I have told Amara and the family.");
  });

  it("refuses a caregiver and an observer, a real circle, a part that is not the call's, and text sent in", async () => {
    const { circle, shiftId } = await finishedVisit();
    for (const persona of ["amara", "daniel"] as const) {
      const { context } = await speech(circle, persona);
      expect(await sayShiftCall(context, { shiftId, part: "question", locale: "en" }), persona).toEqual({ ok: false, reason: "refused" });
    }
    const { context } = await speech(circle, "rose");
    expect(await sayShiftCall(context, { shiftId, part: "Say anything you like", locale: "en" })).toEqual({ ok: false, reason: "invalid" });
    expect(await sayShiftCall(context, { shiftId, part: "question", locale: "xx" })).toEqual({ ok: false, reason: "invalid" });
    const real = await speech(circle, "rose", (seen) => ({ ...seen, circle: { ...seen.circle, demo: false } }));
    expect(await sayShiftCall(real.context, { shiftId, part: "question", locale: "en" })).toEqual({ ok: false, reason: "refused" });
    expect(real.voice.said).toEqual([]);
  });

  it("says plainly when a language has no voice, so the screen shows the words instead", async () => {
    const { circle, shiftId } = await finishedVisit();
    const { context } = await speech(circle, "rose");
    expect(await sayShiftCall(context, { shiftId, part: "question", locale: "he" })).toEqual({ ok: false, reason: "no_voice" });
  });
});
