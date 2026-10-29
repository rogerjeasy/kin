import { asPerson, configureCaregiver, readCircle, takeDemoSeat, type CircleSnapshot } from "@kin/db";
import { seatPerson, serviceRows, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { fakeTranscriber, fakeVoice } from "@kin/speech/testing";
import { testDatabases } from "../../../../packages/db/src/testing/databases.ts";
import { describe, expect, it } from "vitest";

import { createRateLimiter } from "./model";
import { answerByVoice, sayBill, sayProposal, transcribe, type SpeechContext } from "./speech-actions";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");
const pcm = new Uint8Array(3_200);
const details = { version: 1, currency: "USD", rateCentsPerHour: 2200, visits: [{ date: "2026-10-20", minutes: 240 }, { date: "2026-10-21", minutes: 150 }] };

const snapshot = (circle: VisitorCircle, userId: string): Promise<CircleSnapshot> => asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: CLOCK }));
const as = (circle: VisitorCircle, persona: keyof VisitorCircle["members"]) => asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members[persona]));

async function caregiverCircle() {
  const circle = await visitorWithCircle(db);
  const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
  await asPerson(db.app, circle.userId, (tx) => configureCaregiver(tx, { circleId: circle.circleId, memberId: circle.members.amara, payeeId: circle.payees.amara, name: "Amara", rateCentsPerHour: 2200 }));
  return { circle, caregiver };
}
function context(circle: CircleSnapshot, userId: string, services: Partial<SpeechContext> = {}): SpeechContext {
  return { db: db.app, userId, circle, accountTypes: "demo", services: { transcriber: fakeTranscriber(), voice: fakeVoice() }, ...services };
}
// A waiting proposal the viewer has not answered yet.
const pending = (circle: CircleSnapshot) => {
  const proposal = circle.proposals.find((each) => each.state === "pending_approval" && each.votes.every((vote) => vote.memberId !== circle.viewer.memberId));
  if (!proposal) throw new Error("The demo has no waiting proposal");
  return proposal;
};

describe("Kin's voice reading a caregiver's bill", () => {
  it("reads the server's own calculation, with every day, the rate and the total", async () => {
    const { circle, caregiver } = await caregiverCircle();
    const voice = fakeVoice();
    const result = await sayBill(context(await snapshot(circle, caregiver), caregiver, { services: { transcriber: fakeTranscriber(), voice } }), { details, locale: "en" });
    expect(result).toMatchObject({ ok: true, contentType: "audio/mpeg" });
    expect(voice.said[0]?.text).toBe("Amara, here is your bill: Tuesday, October 20, 2026, 4 hours and Wednesday, October 21, 2026, 2.5 hours. At $22.00 an hour, the total is $143.00. Say yes to submit it, or no to change it.");
  });

  it("refuses details that are not this caregiver's bill, and says plainly when a language has no voice", async () => {
    const { circle, caregiver } = await caregiverCircle();
    const seen = await snapshot(circle, caregiver);
    for (const forged of [{ ...details, rateCentsPerHour: 1 }, { ...details, currency: "EUR" }, { ...details, visits: [] }, "Say anything"]) {
      expect(await sayBill(context(seen, caregiver), { details: forged, locale: "en" })).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await sayBill(context(seen, caregiver), { details, locale: "he" })).toEqual({ ok: false, reason: "no_voice" });
    expect(await sayBill(context(seen, caregiver), { details, locale: "xx" })).toEqual({ ok: false, reason: "invalid" });
    expect(await sayBill(context(await snapshot(circle, circle.userId), circle.userId), { details, locale: "en" })).toEqual({ ok: false, reason: "refused" });
  });
});

describe("Kin listening", () => {
  it("writes down what the caregiver said and whether it was a clear yes", async () => {
    const { circle, caregiver } = await caregiverCircle();
    const seen = await snapshot(circle, caregiver);
    const transcriber = fakeTranscriber("Yes, submit it.");
    expect(await transcribe(context(seen, caregiver, { services: { transcriber, voice: fakeVoice() } }), { pcm, locale: "en" })).toEqual({ ok: true, transcript: "Yes, submit it.", answer: "yes" });
    expect(transcriber.heard).toEqual([{ bytes: 3_200, locale: "en" }]);
  });

  it("refuses an observer, odd or oversized audio, an unknown language, and a deployment without speech", async () => {
    const { circle, caregiver } = await caregiverCircle();
    const seen = await snapshot(circle, caregiver);
    expect(await transcribe(context(seen, caregiver), { pcm: new Uint8Array(3), locale: "en" })).toEqual({ ok: false, reason: "recording" });
    expect(await transcribe(context(seen, caregiver), { pcm: new Uint8Array(0), locale: "en" })).toEqual({ ok: false, reason: "recording" });
    expect(await transcribe(context(seen, caregiver), { pcm: new Uint8Array(1_920_002), locale: "en" })).toEqual({ ok: false, reason: "recording" });
    expect(await transcribe(context(seen, caregiver), { pcm, locale: "klingon" })).toEqual({ ok: false, reason: "invalid" });
    expect(await transcribe(context(seen, caregiver, { services: null }), { pcm, locale: "en" })).toEqual({ ok: false, reason: "speech_unavailable" });
    await as(circle, "daniel");
    expect(await transcribe(context(await snapshot(circle, circle.userId), circle.userId), { pcm, locale: "en" })).toEqual({ ok: false, reason: "refused" });
  });

  it("is limited per person and per pool, and a refused request uses nothing", async () => {
    const { circle, caregiver } = await caregiverCircle();
    const seen = await snapshot(circle, caregiver);
    const limiter = createRateLimiter(1, 60_000);
    const budget = createRateLimiter(5, 60_000);
    const ask = () => transcribe(context(seen, caregiver, { services: { transcriber: fakeTranscriber("Monday four hours"), voice: fakeVoice() }, limiter, budget, now: () => 0 }), { pcm, locale: "en" });
    expect(await ask()).toMatchObject({ ok: true });
    expect(await ask()).toEqual({ ok: false, reason: "busy" });
    expect(budget.allows("demo", 0)).toBe(true);
  });
});

describe("a spoken answer to a proposal", () => {
  it("reads the proposal, hears the answer, reads it back, and records it only after a spoken yes", async () => {
    const circle = await visitorWithCircle(db);
    await as(circle, "rose");
    const seen = await snapshot(circle, circle.userId);
    const proposal = pending(seen);
    const voice = fakeVoice();
    const transcriber = fakeTranscriber("Yes.", "Yes, I confirm.");
    const speak = context(seen, circle.userId, { services: { transcriber, voice } });

    expect(await sayProposal(speak, { proposalId: proposal.id, locale: "en", decision: null })).toMatchObject({ ok: true });
    expect(voice.said[0]?.text).toMatch(/Do you approve\? Say yes or no\.$/);
    expect(await answerByVoice(speak, { proposalId: proposal.id, pcm, locale: "en", step: "answer", decision: null })).toEqual({ ok: true, decision: "approve", outcome: "heard" });
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from approvals where proposal_id = $1 and member_id = $2", [proposal.id, circle.members.rose])).toEqual([{ n: 0 }]);

    await sayProposal(speak, { proposalId: proposal.id, locale: "en", decision: "approve" });
    expect(voice.said[1]?.text).toMatch(/^You said yes to paying \$[\d,.]+ to .+\. Say yes again to confirm\.$/);
    const confirmed = await answerByVoice(speak, { proposalId: proposal.id, pcm, locale: "en", step: "confirm", decision: "approve" });
    expect(confirmed).toMatchObject({ ok: true, decision: "approve" });
    expect(await serviceRows(db, circle.circleId, "select method, decision, evidence_ref like 'voice:%' as evidence from approvals where proposal_id = $1 and member_id = $2", [proposal.id, circle.members.rose])).toEqual([{ method: "voice", decision: "approve", evidence: true }]);
  });

  it("records nothing when the confirmation is not a clear yes, or the first answer is unclear", async () => {
    const circle = await visitorWithCircle(db);
    await as(circle, "rose");
    const seen = await snapshot(circle, circle.userId);
    const proposal = pending(seen);
    const speak = context(seen, circle.userId, { services: { transcriber: fakeTranscriber("Hmm, maybe later", "No, wait"), voice: fakeVoice() } });
    expect(await answerByVoice(speak, { proposalId: proposal.id, pcm, locale: "en", step: "answer", decision: null })).toEqual({ ok: false, reason: "unclear" });
    expect(await answerByVoice(speak, { proposalId: proposal.id, pcm, locale: "en", step: "confirm", decision: "approve" })).toEqual({ ok: false, reason: "not_confirmed" });
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from approvals where proposal_id = $1 and member_id = $2", [proposal.id, circle.members.rose])).toEqual([{ n: 0 }]);
  });

  it("is refused for real money, to a caregiver, and for a proposal that is not waiting", async () => {
    const { circle, caregiver } = await caregiverCircle();
    const seen = await snapshot(circle, circle.userId);
    const proposal = pending(seen);
    expect(await answerByVoice(context(await snapshot(circle, caregiver), caregiver), { proposalId: proposal.id, pcm, locale: "en", step: "answer", decision: null })).toEqual({ ok: false, reason: "refused" });
    expect(await answerByVoice(context(seen, circle.userId), { proposalId: crypto.randomUUID(), pcm, locale: "en", step: "answer", decision: null })).toEqual({ ok: false, reason: "refused" });
    const real = { ...seen, circle: { ...seen.circle, demo: false } };
    expect(await answerByVoice(context(real, circle.userId), { proposalId: proposal.id, pcm, locale: "en", step: "answer", decision: null })).toEqual({ ok: false, reason: "refused" });
  });
});
