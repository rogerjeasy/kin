import { fakeModel } from "@kin/agent/testing";
import { asPerson, readCircle, type CircleSnapshot } from "@kin/db";
import { seatPerson, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { fakeTranscriber, fakeVoice } from "@kin/speech/testing";
import { describe, expect, it } from "vitest";

import { keptPay, wishesAsking } from "@/content/circle/wishes";

import { createRateLimiter } from "./model";
import { wavFromPcm } from "./wav";
import { keepRecording, runWishes, wishAudio, type WishesContext } from "./wishes";
import { testDatabases } from "../../../../packages/db/src/testing/databases.ts";

const db = testDatabases();

const snapshot = (circle: VisitorCircle, userId: string): Promise<CircleSnapshot> =>
  asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: new Date("2026-10-30T18:00:00Z") }));
const context = (circle: CircleSnapshot, userId: string, change: Partial<WishesContext> = {}): WishesContext => ({
  db: db.app,
  userId,
  circle,
  accountTypes: "demo",
  model: null,
  services: null,
  ...change,
});
const json = (value: unknown) => ({ kind: "json" as const, text: JSON.stringify(value) });

describe("the parent's wishes, through the request boundary", () => {
  it("reads her words back as drafts with the record's IDs, keeps the one she confirms, and her family witnesses it", async () => {
    const circle = await visitorWithCircle(db);
    const rose = (await seatPerson(db, circle.circleId, circle.members.rose)) as string;
    const seen = await snapshot(circle, rose);
    const quote = "Keep paying Amara for my Sunday visits.";
    const model = fakeModel(json({ wishes: [{ quote, kind: "keep_paying", trigger: "either", payee: "c1", subscriptions: [], amount: null, approvers: [], successor: null, why: null }] }));
    const drafted = await runWishes(context(seen, rose, { model }), { operation: "draft", said: quote, locale: "en" });
    expect(drafted).toEqual({ ok: true, wishes: [{ kind: "draft", draft: { quote, trigger: "either", rule: { kind: "keep_paying", payeeId: circle.payees.amara } } }] });
    // The model saw a slot, never an ID.
    expect(model.requests[0]?.user).not.toContain(circle.payees.amara);

    const kept = await runWishes(context(seen, rose), { operation: "keep", quote, trigger: "either", rule: { kind: "keep_paying", payeeId: circle.payees.amara }, recordingId: null, wishKey: null, method: "app" });
    expect(kept).toMatchObject({ ok: true });
    const after = await snapshot(circle, circle.userId);
    const wish = after.wishes.wishes.find((each) => each.quote === quote);
    expect(wish?.state).toBe("confirmed");
    expect(await runWishes(context(after, circle.userId), { operation: "witness", wishId: wish?.id })).toMatchObject({ ok: true, state: "confirmed" });
  });

  it("refuses each role what it may not do, before asking the database", async () => {
    const circle = await visitorWithCircle(db);
    const [amara, daniel] = await Promise.all([seatPerson(db, circle.circleId, circle.members.amara), seatPerson(db, circle.circleId, circle.members.daniel)]);
    const elena = await snapshot(circle, circle.userId);
    const model = fakeModel();
    expect(await runWishes(context(elena, circle.userId, { model }), { operation: "draft", said: "Pay me", locale: "en" })).toEqual({ ok: false, reason: "refused" });
    expect(model.requests).toHaveLength(0);
    expect(await runWishes(context(elena, circle.userId), { operation: "keep", quote: "x", trigger: "either", rule: { kind: "pause_discretionary" }, recordingId: null, wishKey: null })).toEqual({ ok: false, reason: "refused" });
    const observer = await snapshot(circle, daniel as string);
    for (const operation of ["witness", "withdraw"]) expect(await runWishes(context(observer, daniel as string), { operation, wishId: circle.circleId })).toEqual({ ok: false, reason: "refused" });
    expect(await runWishes(context(observer, daniel as string), { operation: "attest", event: "hospital", stance: "start" })).toEqual({ ok: false, reason: "refused" });
    const caregiver = await snapshot(circle, amara as string);
    expect(await wishAudio(context(caregiver, amara as string), { wishId: circle.circleId, locale: "en" })).toEqual({ ok: false, reason: "refused" });
    expect(await runWishes(context(caregiver, amara as string), { operation: "subscription", name: "Gym", monthly: "10.00", paypalSubscriptionId: null })).toEqual({ ok: false, reason: "refused" });
  });

  it("takes only the operation's own fields and a rule of the record's shape", async () => {
    const circle = await visitorWithCircle(db);
    const rose = (await seatPerson(db, circle.circleId, circle.members.rose)) as string;
    const seen = await snapshot(circle, rose);
    const keep = (change: Record<string, unknown>) => runWishes(context(seen, rose), { operation: "keep", quote: "Hold the extras.", trigger: "either", rule: { kind: "pause_discretionary" }, recordingId: null, wishKey: null, ...change });
    expect(await keep({ extra: 1 })).toEqual({ ok: false, reason: "invalid" });
    expect(await keep({ trigger: "always" })).toEqual({ ok: false, reason: "invalid" });
    expect(await keep({ rule: { kind: "pause_discretionary", payeeId: circle.payees.amara } })).toEqual({ ok: false, reason: "invalid" });
    expect(await keep({ rule: { kind: "keep_paying", payeeId: circle.payees.gas } })).toEqual({ ok: false, reason: "payee" });
    expect(await keep({ quote: "<script>" })).toEqual({ ok: false, reason: "quote" });
    expect(await runWishes(context(seen, rose), { operation: "draft", said: "Hold the extras.", locale: "en" })).toEqual({ ok: false, reason: "model_unavailable" });
  });

  it("keeps her recording as WAV and plays it back to the family; a wish without one is read by Kin's voice", async () => {
    const circle = await visitorWithCircle(db);
    const rose = (await seatPerson(db, circle.circleId, circle.members.rose)) as string;
    const seen = await snapshot(circle, rose);
    const pcm = new Uint8Array(3200);
    const kept = await keepRecording(context(seen, rose, { services: { transcriber: fakeTranscriber("Keep the heating on."), voice: fakeVoice() } }), { pcm, locale: "en" });
    expect(kept).toMatchObject({ ok: true, transcript: "Keep the heating on." });
    if (!kept.ok) throw new Error("not kept");
    await runWishes(context(seen, rose), { operation: "keep", quote: "Keep the heating on.", trigger: "either", rule: { kind: "pause_discretionary" }, recordingId: kept.recordingId, wishKey: null });
    const family = await snapshot(circle, circle.userId);
    const recorded = family.wishes.wishes.find((wish) => wish.recordingId === kept.recordingId);
    expect(await wishAudio(context(family, circle.userId), { wishId: recorded?.id, locale: "en" })).toEqual({ ok: true, audio: wavFromPcm(pcm), contentType: "audio/wav" });
    const voice = fakeVoice();
    const seeded = family.wishes.wishes.find((wish) => wish.recordingId === null);
    const read = await wishAudio(context(family, circle.userId, { services: { transcriber: fakeTranscriber(), voice } }), { wishId: seeded?.id, locale: "en" });
    expect(read).toMatchObject({ ok: true, contentType: "audio/mpeg" });
    // Kin reads her stored words, never text sent in.
    expect(voice.said).toEqual([{ text: seeded?.quote, locale: "en" }]);
    expect(await wishAudio(context(family, circle.userId), { wishId: seeded?.id, locale: "en" })).toEqual({ ok: false, reason: "speech_unavailable" });
  });

  it("limits how often one person may use the model and speech", async () => {
    const circle = await visitorWithCircle(db);
    const rose = (await seatPerson(db, circle.circleId, circle.members.rose)) as string;
    const seen = await snapshot(circle, rose);
    const limiter = createRateLimiter(1, 60_000);
    const model = fakeModel(json({ wishes: [] }), json({ wishes: [] }));
    const ask = () => runWishes(context(seen, rose, { model, limiter }), { operation: "draft", said: "Hold the extras.", locale: "en" });
    expect(await ask()).toEqual({ ok: true, wishes: [] });
    expect(await ask()).toEqual({ ok: false, reason: "busy" });
  });
});

describe("what the screens read while her wishes are in effect", () => {
  it("cites her two-approval wish on a payment to someone new, and shows Amara's next shift as kept paid", async () => {
    const circle = await visitorWithCircle(db);
    const marcus = (await seatPerson(db, circle.circleId, circle.members.marcus)) as string;
    const before = await snapshot(circle, circle.userId);
    const stairlift = before.proposals.find((proposal) => "payeeId" in proposal.to && proposal.to.payeeId === circle.payees.stairlift);
    if (!stairlift) throw new Error("No stairlift proposal in the demo");
    expect(wishesAsking(before, stairlift)).toBeNull();
    await runWishes(context(before, circle.userId), { operation: "attest", event: "hospital", stance: "start" });
    await runWishes(context(await snapshot(circle, marcus), marcus), { operation: "attest", event: "hospital", stance: "start" });
    const during = await snapshot(circle, circle.userId);
    const asked = wishesAsking(during, stairlift);
    expect(asked?.memberIds.toSorted()).toEqual([circle.members.elena, circle.members.marcus].toSorted());
    expect(asked?.wishes[0]?.quote).toContain("unless Elena and Marcus both agree");
    expect(keptPay(during).map((each) => each.payeeId)).toEqual([circle.payees.amara]);
  });
});
