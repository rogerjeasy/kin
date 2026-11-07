import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { LetterError, addLetter, recordClaimCheck, type LetterInput } from "./letters.ts";
import { takeDemoSeat } from "./people.ts";
import { readCircle } from "./read-circle.ts";
import { auditLog, bills, claimChecks, documents, narrations, payees } from "./schema/index.ts";
import { asPerson, asService } from "./scope.ts";
import { addMember, seatPerson, visitorWithCircle, type VisitorCircle } from "./testing/circles.ts";
import { testDatabases } from "./testing/databases.ts";
import { errorCode, REFUSED } from "./testing/sql.ts";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");

const reading = { kind: "bill", sender: "Greenway Power", amountCents: 8_640, dueOn: "2026-11-20", demandsPayment: true, pressure: false, confidence: 0.9, source: "model_text" };
const letter = (circle: VisitorCircle, overrides: Partial<LetterInput> = {}): LetterInput => ({
  circleId: circle.circleId,
  kind: "bill",
  payeeId: null,
  sender: "Greenway Power",
  amountCents: 8_640,
  dueOn: "2026-11-20",
  extraction: reading,
  confidence: 0.9,
  ...overrides,
});
const asPersona = <T>(circle: VisitorCircle, persona: keyof VisitorCircle["members"], work: Parameters<typeof asPerson<T>>[2]) =>
  asPerson(db.app, circle.userId, async (tx) => {
    await takeDemoSeat(tx, circle.circleId, circle.members[persona]);
    return work(tx);
  });
const claim = (circle: VisitorCircle, overrides: Partial<Parameters<typeof recordClaimCheck>[1]> = {}) => ({
  circleId: circle.circleId,
  payeeId: null,
  claimedCents: 8_640,
  claim: "Revenue Recovery: pay now",
  foundEntryId: null,
  verdict: "no_match" as const,
  topic: "falseDemand",
  spoken: "Nobody by that name is in the record. Please do not pay.",
  ...overrides,
});

describe("adding what Kin read from a letter", () => {
  it("records the document and a bill waiting for review, under a new payee the circle is told about", async () => {
    const circle = await visitorWithCircle(db);
    const recorded = await asPersona(circle, "rose", (tx) => addLetter(tx, letter(circle)));
    expect(recorded).toMatchObject({ billState: "needs_review", duplicateOf: null });

    const rows = await asService(db.service, circle.circleId, async (tx) => ({
      document: (await tx.select().from(documents).where(eq(documents.id, recorded.documentId)))[0],
      bill: (await tx.select().from(bills).where(eq(bills.id, recorded.billId ?? "")))[0],
      payee: (await tx.select().from(payees).where(eq(payees.id, recorded.payeeId ?? "")))[0],
      audit: await tx.select().from(auditLog).where(and(eq(auditLog.circleId, circle.circleId), eq(auditLog.action, "letter.read"))),
    }));
    expect(rows.document).toMatchObject({ kind: "bill", simulated: true, storageKey: null, extraction: reading, confidence: 0.9 });
    expect(rows.bill).toMatchObject({ amountCents: 8_640, dueOn: "2026-11-20", state: "needs_review", documentId: recorded.documentId });
    expect(rows.payee).toMatchObject({ name: "Greenway Power", status: "new", category: "other", memberId: null });
    expect(rows.audit).toHaveLength(1);
  });

  it("files the bill under a payee the circle already has, and recognises a repeat as a duplicate of the first", async () => {
    const circle = await visitorWithCircle(db);
    const first = await asPersona(circle, "elena", (tx) => addLetter(tx, letter(circle, { payeeId: circle.payees.water })));
    expect(first).toMatchObject({ billState: "needs_review", payeeId: circle.payees.water });
    const again = await asPersona(circle, "rose", (tx) => addLetter(tx, letter(circle, { payeeId: circle.payees.water })));
    expect(again).toMatchObject({ billState: "duplicate", duplicateOf: first.billId });
  });

  it("keeps only the reading when there is no bill to list: a letter, or a sender nobody could name", async () => {
    const circle = await visitorWithCircle(db);
    const noBill = await asPersona(circle, "rose", (tx) => addLetter(tx, letter(circle, { kind: "letter", sender: null, amountCents: null })));
    expect(noBill).toMatchObject({ billId: null, billState: null, payeeId: null });
    const unnamed = await asPersona(circle, "rose", (tx) => addLetter(tx, letter(circle, { sender: null })));
    expect(unnamed.billId).toBeNull();
  });

  it("is refused to a caregiver and to an observer, whatever the screen offers", async () => {
    const circle = await visitorWithCircle(db);
    const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
    const observer = await addMember(db, circle.circleId, "observer");
    for (const person of [caregiver, observer.userId]) {
      await expect(asPerson(db.app, person, (tx) => addLetter(tx, letter(circle)))).rejects.toBeInstanceOf(LetterError);
      await expect(asPerson(db.app, person, (tx) => addLetter(tx, letter(circle)))).rejects.toMatchObject({ reason: "refused" });
    }
    const rows = await asService(db.service, circle.circleId, (tx) => tx.select().from(documents).where(eq(documents.circleId, circle.circleId)));
    // Only the demo's own two documents: nothing refused left a row behind.
    expect(rows).toHaveLength(2);
  });

  it("refuses to file a letter under a caregiver, under another circle's payee, or with a nonsensical reading", async () => {
    const circle = await visitorWithCircle(db);
    const other = await visitorWithCircle(db);
    for (const bad of [{ payeeId: circle.payees.amara }, { payeeId: other.payees.water }]) {
      await expect(asPersona(circle, "elena", (tx) => addLetter(tx, letter(circle, bad)))).rejects.toMatchObject({ reason: "refused" });
    }
    for (const bad of [{ amountCents: 0 }, { amountCents: -5 }, { sender: "x".repeat(81) }, { sender: "  " }, { confidence: 1.5 }]) {
      await expect(asPersona(circle, "elena", (tx) => addLetter(tx, letter(circle, bad)))).rejects.toMatchObject({ reason: "invalid" });
    }
  });

  it("shows another circle nothing of it", async () => {
    const circle = await visitorWithCircle(db);
    const other = await visitorWithCircle(db);
    const recorded = await asPersona(circle, "rose", (tx) => addLetter(tx, letter(circle)));
    const seen = await asPerson(db.app, other.userId, (tx) => readCircle(tx, { circleId: other.circleId, userId: other.userId, now: CLOCK }));
    expect(seen.documents.map((each) => each.id)).not.toContain(recorded.documentId);
    expect(seen.bills.map((each) => each.id)).not.toContain(recorded.billId);
    // And cannot write into it: the circle named must be the viewer's own.
    await expect(asPerson(db.app, other.userId, (tx) => addLetter(tx, letter(circle)))).rejects.toMatchObject({ reason: "refused" });
  });
});

describe("recording a checked demand", () => {
  it("records the verdict, tells every member who sees the circle's money, and keeps the words Kin spoke", async () => {
    const circle = await visitorWithCircle(db);
    const id = await asPersona(circle, "elena", (tx) => recordClaimCheck(tx, claim(circle)));
    const seen = await asPerson(db.app, circle.userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId: circle.userId, now: CLOCK }));
    const check = seen.claimChecks.find((each) => each.id === id);
    expect(check).toMatchObject({ verdict: "no_match", claimedCents: 8_640, claim: "Revenue Recovery: pay now", payeeId: null });
    const told = seen.members.filter((member) => member.status === "active" && member.role !== "caregiver").map((member) => member.id);
    expect(check?.alerted.toSorted()).toEqual(told.toSorted());
    const words = seen.narrations.filter((each) => each.claimCheckId === id);
    expect(words.map((each) => each.memberId).toSorted()).toEqual(told.toSorted());
    expect(words.every((each) => each.topic === "falseDemand" && each.state === "queued" && each.spokenText === claim(circle).spoken)).toBe(true);
  });

  it("puts the newest check first, even on the same day", async () => {
    const circle = await visitorWithCircle(db);
    const first = await asPersona(circle, "elena", (tx) => recordClaimCheck(tx, claim(circle, { claim: "first" })));
    const second = await asPersona(circle, "elena", (tx) => recordClaimCheck(tx, claim(circle, { claim: "second" })));
    const seen = await asPerson(db.app, circle.userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId: circle.userId, now: CLOCK }));
    expect(seen.claimChecks.slice(0, 2).map((each) => each.id)).toEqual([second, first]);
  });

  it("points at a payee and a payment of this circle only", async () => {
    const circle = await visitorWithCircle(db);
    const other = await visitorWithCircle(db);
    expect(await errorCode(asPersona(circle, "elena", (tx) => recordClaimCheck(tx, claim(circle, { payeeId: other.payees.water }))))).toBe(REFUSED.foreignKey);
  });

  it("is refused to a caregiver and an observer, and a caregiver never hears of it", async () => {
    const circle = await visitorWithCircle(db);
    const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
    await expect(asPerson(db.app, caregiver, (tx) => recordClaimCheck(tx, claim(circle)))).rejects.toMatchObject({ reason: "refused" });
    await asPersona(circle, "elena", (tx) => recordClaimCheck(tx, claim(circle)));
    const seen = await asPerson(db.app, caregiver, (tx) => readCircle(tx, { circleId: circle.circleId, userId: caregiver, now: CLOCK }));
    expect([seen.claimChecks, seen.narrations]).toEqual([[], []]);
  });

  it("refuses an empty or oversized claim, an amount that is not positive, and empty words", async () => {
    const circle = await visitorWithCircle(db);
    for (const bad of [{ claim: "  " }, { claim: "x".repeat(501) }, { claimedCents: 0 }, { spoken: "" }, { spoken: "x".repeat(601) }]) {
      await expect(asPersona(circle, "elena", (tx) => recordClaimCheck(tx, claim(circle, bad)))).rejects.toMatchObject({ reason: "invalid" });
    }
    const rows = await asService(db.service, circle.circleId, async (tx) => ({
      checks: await tx.select().from(claimChecks).where(eq(claimChecks.circleId, circle.circleId)),
      words: await tx.select().from(narrations).where(eq(narrations.circleId, circle.circleId)),
    }));
    // Only the demo's own seeded check remains: nothing refused left a row behind.
    expect(rows.checks).toHaveLength(1);
    expect(rows.words.every((each) => each.claimCheckId === rows.checks[0]?.id || each.claimCheckId === null)).toBe(true);
  });
});
