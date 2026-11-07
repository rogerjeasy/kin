import { asPerson, readCircle, takeDemoSeat, type CircleSnapshot } from "@kin/db";
import { addMember, seatPerson, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { fakeTranscriber, fakeVoice } from "@kin/speech/testing";
import { describe, expect, it } from "vitest";

import { testDatabases } from "../../../../packages/db/src/testing/databases.ts";
import { sayClaim, sayLetter } from "./letter-speech";
import { checkDemand, readLetter } from "./letters";
import type { SpeechContext } from "./speech-actions";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");
const LETTER = "Greenway Power\nAmount due: $86.40\nPlease pay by 2026-11-20.";

const snapshot = (circle: VisitorCircle, userId: string): Promise<CircleSnapshot> => asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: CLOCK }));
async function actingAs(circle: VisitorCircle, persona: keyof VisitorCircle["members"]) {
  await asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members[persona]));
  return { db: db.app, userId: circle.userId, circle: await snapshot(circle, circle.userId), accountTypes: "demo" } as const;
}
const speech = (circle: CircleSnapshot, userId: string, voice = fakeVoice()): SpeechContext => ({ db: db.app, userId, circle, accountTypes: "demo", services: { transcriber: fakeTranscriber(), voice } });

describe("Kin reading a letter aloud", () => {
  it("says what the stored reading says, with fixed wording from the record", async () => {
    const circle = await visitorWithCircle(db);
    const read = await readLetter(await actingAs(circle, "rose"), { text: LETTER, locale: "en" });
    if (!read.ok) throw new Error("The letter was not read");
    const voice = fakeVoice();
    const seen = await snapshot(circle, circle.userId);
    expect(await sayLetter(speech(seen, circle.userId, voice), { documentId: read.documentId, locale: "en" })).toMatchObject({ ok: true, contentType: "audio/mpeg" });
    expect(voice.said[0]).toEqual({ text: read.words, locale: "en" });
  });

  it("tells a repeat from a first bill, and speaks in the person's language", async () => {
    const circle = await visitorWithCircle(db);
    await readLetter(await actingAs(circle, "rose"), { text: LETTER, locale: "en" });
    const again = await readLetter(await actingAs(circle, "rose"), { text: LETTER, locale: "en" });
    if (!again.ok) throw new Error("The letter was not read");
    const voice = fakeVoice();
    await sayLetter(speech(await snapshot(circle, circle.userId), circle.userId, voice), { documentId: again.documentId, locale: "fr" });
    expect(voice.said[0]?.text).toContain("Elle ressemble à une facture déjà dans la liste");
  });

  it("refuses an unknown document, a bad ID or language, a caregiver and an observer", async () => {
    const circle = await visitorWithCircle(db);
    const read = await readLetter(await actingAs(circle, "rose"), { text: LETTER, locale: "en" });
    if (!read.ok) throw new Error("The letter was not read");
    const seen = await snapshot(circle, circle.userId);
    expect(await sayLetter(speech(seen, circle.userId), { documentId: crypto.randomUUID(), locale: "en" })).toEqual({ ok: false, reason: "refused" });
    expect(await sayLetter(speech(seen, circle.userId), { documentId: "x", locale: "en" })).toEqual({ ok: false, reason: "invalid" });
    expect(await sayLetter(speech(seen, circle.userId), { documentId: read.documentId, locale: "xx" })).toEqual({ ok: false, reason: "invalid" });
    const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
    const observer = await addMember(db, circle.circleId, "observer");
    for (const person of [caregiver, observer.userId]) {
      expect(await sayLetter(speech(await snapshot(circle, person), person), { documentId: read.documentId, locale: "en" })).toEqual({ ok: false, reason: "refused" });
    }
  });

  it("refuses a seeded document that holds no reading", async () => {
    const circle = await visitorWithCircle(db);
    await asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members.rose));
    const seen = await snapshot(circle, circle.userId);
    const seeded = seen.documents[0];
    expect(await sayLetter(speech(seen, circle.userId), { documentId: seeded?.id ?? "", locale: "en" })).toEqual({ ok: false, reason: "refused" });
  });
});

describe("Kin telling a member what it found about a demand", () => {
  it("speaks the words stored for that member when the check was recorded", async () => {
    const circle = await visitorWithCircle(db);
    const result = await checkDemand(await actingAs(circle, "elena"), { payee: "Revenue Recovery Dept", amount: "300", claim: "", locale: "en" });
    if (!result.ok) throw new Error("The demand was not checked");
    const voice = fakeVoice();
    await actingAs(circle, "rose");
    const rose = await snapshot(circle, circle.userId);
    expect(await sayClaim(speech(rose, circle.userId, voice), { claimCheckId: result.claimCheckId, locale: "en" })).toMatchObject({ ok: true });
    expect(voice.said[0]).toEqual({ text: result.words, locale: "en" });
  });

  it("refuses an unknown check, a bad ID, and anyone it was not told to or who may not see the safety record", async () => {
    const circle = await visitorWithCircle(db);
    const result = await checkDemand(await actingAs(circle, "elena"), { payee: "Revenue Recovery Dept", amount: "300", claim: "", locale: "en" });
    if (!result.ok) throw new Error("The demand was not checked");
    const seen = await snapshot(circle, circle.userId);
    expect(await sayClaim(speech(seen, circle.userId), { claimCheckId: crypto.randomUUID(), locale: "en" })).toEqual({ ok: false, reason: "refused" });
    expect(await sayClaim(speech(seen, circle.userId), { claimCheckId: "x", locale: "en" })).toEqual({ ok: false, reason: "invalid" });
    const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
    expect(await sayClaim(speech(await snapshot(circle, caregiver), caregiver), { claimCheckId: result.claimCheckId, locale: "en" })).toEqual({ ok: false, reason: "refused" });
    // A member joined after the check was recorded was never told, so has nothing to hear.
    const late = await addMember(db, circle.circleId, "observer");
    expect(await sayClaim(speech(await snapshot(circle, late.userId), late.userId), { claimCheckId: result.claimCheckId, locale: "en" })).toEqual({ ok: false, reason: "refused" });
  });
});
