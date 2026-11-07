import { asPerson, readCircle, takeDemoSeat, type CircleSnapshot } from "@kin/db";
import { seatPerson, serviceRows, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { fakeTranscriber, fakeVoice } from "@kin/speech/testing";
import { describe, expect, it } from "vitest";

import { refillViews } from "@/content/circle/refills";

import { runRefill, type RefillContext } from "./refills";
import { answerByVoice, sayProposal, type SpeechContext } from "./speech-actions";
import { testDatabases } from "../../../../packages/db/src/testing/databases.ts";

const db = testDatabases();
const pcm = new Uint8Array(3_200);

const snapshot = (circle: VisitorCircle, userId: string): Promise<CircleSnapshot> =>
  asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: new Date("2026-10-30T18:00:00Z") }));
const refillContext = (circle: CircleSnapshot, userId: string): RefillContext => ({ db: db.app, userId, circle });
const ruleOf = (circle: CircleSnapshot) => {
  const [rule] = circle.purchaseRules;
  if (!rule) throw new Error("The demo has no refill rule");
  return rule.id;
};
const speech = (circle: CircleSnapshot, userId: string, said: string): SpeechContext & { voice: ReturnType<typeof fakeVoice> } => {
  const voice = fakeVoice();
  return { db: db.app, userId, circle, accountTypes: "demo", services: { transcriber: fakeTranscriber(said), voice }, voice };
};

describe("asking Kin to reorder", () => {
  it("raises a refill for the family from the rule alone, and the screen then shows it waiting", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    const before = refillViews(seen);
    expect(before.rules).toMatchObject([{ askable: true, remainingCents: 15000 }]);
    expect(before.orders).toEqual([]);

    const result = await runRefill(refillContext(seen, circle.userId), { ruleId: ruleOf(seen) });
    expect(result).toMatchObject({ ok: true });

    const after = refillViews(await snapshot(circle, circle.userId));
    expect(after.orders).toMatchObject([{ proposalState: "pending_approval", purchase: { state: "awaiting", cents: 6400 } }]);
    // One refill waits at a time, so the button is not offered again, and its cost counts against the month.
    expect(after.rules).toMatchObject([{ askable: false, remainingCents: 15000 - 6400 }]);
  });

  it("takes nothing from the request but a rule's ID: an amount, a seller or a stray field is refused", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    const ruleId = ruleOf(seen);
    for (const forged of [null, "x", [], {}, { ruleId: "not-an-id" }, { ruleId, cents: 1 }, { ruleId, seller: "me" }, { ruleId: 7 }]) {
      expect(await runRefill(refillContext(seen, circle.userId), forged)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from purchases where circle_id = $1", [circle.circleId])).toEqual([{ n: 0 }]);
  });

  it("is refused for a caregiver and an observer, whatever rule they name", async () => {
    const circle = await visitorWithCircle(db);
    const ruleId = ruleOf(await snapshot(circle, circle.userId));
    for (const persona of ["amara", "daniel"] as const) {
      const userId = await seatPerson(db, circle.circleId, circle.members[persona]);
      const seen = await snapshot(circle, userId);
      expect(await runRefill(refillContext(seen, userId), { ruleId })).toEqual({ ok: false, reason: "refused" });
    }
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from purchases where circle_id = $1", [circle.circleId])).toEqual([{ n: 0 }]);
  });

  it("shows a caregiver no rule and no order, and offers the observer no button", async () => {
    const circle = await visitorWithCircle(db);
    const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
    expect(refillViews(await snapshot(circle, caregiver))).toEqual({ rules: [], orders: [] });
    const observer = await seatPerson(db, circle.circleId, circle.members.daniel);
    expect(refillViews(await snapshot(circle, observer)).rules).toMatchObject([{ askable: false }]);
  });

  it("is refused while the circle is paused, and by the database in a real circle", async () => {
    const circle = await visitorWithCircle(db);
    const ruleId = ruleOf(await snapshot(circle, circle.userId));
    await serviceRows(db, circle.circleId, "update circles set paused_until = clock_at + interval '2 hours', paused_by = $2 where id = $1", [circle.circleId, circle.members.elena]);
    const paused = await snapshot(circle, circle.userId);
    expect(refillViews(paused).rules).toMatchObject([{ askable: false }]);
    expect(await runRefill(refillContext(paused, circle.userId), { ruleId })).toEqual({ ok: false, reason: "paused" });

    await serviceRows(db, circle.circleId, "update circles set paused_until = null, paused_by = null, demo = false, clock_at = null where id = $1", [circle.circleId]);
    expect(await runRefill(refillContext(await snapshot(circle, circle.userId), circle.userId), { ruleId })).toEqual({ ok: false, reason: "demo_only" });
  });
});

describe("Rose approving a refill by voice", () => {
  it("hears it read with the pharmacy and the amount from the record, then records her spoken yes as the approval that queues the purchase", async () => {
    const circle = await visitorWithCircle(db);
    const elena = await snapshot(circle, circle.userId);
    await runRefill(refillContext(elena, circle.userId), { ruleId: ruleOf(elena) });
    await asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members.rose));
    const rose = await snapshot(circle, circle.userId);
    const refill = rose.proposals.find((each) => each.kind === "purchase");
    if (!refill) throw new Error("The refill was not raised");
    expect(rose.viewer.role).toBe("parent");

    const reading = speech(rose, circle.userId, "yes");
    expect(await sayProposal(reading, { proposalId: refill.id, locale: "en", decision: null })).toMatchObject({ ok: true });
    expect(reading.voice.said[0]?.text).toContain("Elm Street Pharmacy refill");
    expect(reading.voice.said[0]?.text).toContain("$64.00");

    expect(await answerByVoice(speech(rose, circle.userId, "yes"), { proposalId: refill.id, pcm, locale: "en", step: "answer", decision: null })).toEqual({ ok: true, decision: "approve", outcome: "heard" });
    expect(await answerByVoice(speech(rose, circle.userId, "yes, go ahead"), { proposalId: refill.id, pcm, locale: "en", step: "confirm", decision: "approve" })).toEqual({ ok: true, decision: "approve", outcome: "approved" });

    const [vote] = await serviceRows(db, circle.circleId, "select method, evidence_ref from approvals where proposal_id = $1", [refill.id]);
    expect(vote).toMatchObject({ method: "voice", evidence_ref: expect.stringMatching(/^voice:[0-9a-f]{16}$/) });
    const [queued] = await serviceRows(db, circle.circleId, "select topic from outbox where circle_id = $1 and sent_at is null and topic = 'purchase.execute'", [circle.circleId]);
    expect(queued).toEqual({ topic: "purchase.execute" });
  });

  it("does not approve when the read-back is not confirmed with a clear yes", async () => {
    const circle = await visitorWithCircle(db);
    const elena = await snapshot(circle, circle.userId);
    await runRefill(refillContext(elena, circle.userId), { ruleId: ruleOf(elena) });
    await asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members.rose));
    const rose = await snapshot(circle, circle.userId);
    const refill = rose.proposals.find((each) => each.kind === "purchase");
    if (!refill) throw new Error("The refill was not raised");
    expect(await answerByVoice(speech(rose, circle.userId, "hmm, let me think"), { proposalId: refill.id, pcm, locale: "en", step: "confirm", decision: "approve" })).toEqual({ ok: false, reason: "not_confirmed" });
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from approvals where proposal_id = $1", [refill.id])).toEqual([{ n: 0 }]);
  });
});
