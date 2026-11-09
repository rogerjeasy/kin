import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { claimOutbox } from "./payouts.ts";
import { hashCheckToken, newCheckToken } from "./check-links.ts";
import {
  PRESENCE_ASK_TOPIC,
  PRESENCE_CONFIRM_TOPIC,
  PresenceError,
  addTrustedVoice,
  answerPresenceCheck,
  answerPresenceCheckByCall,
  confirmTrustedVoice,
  openPresenceCheck,
  openPresenceCheckByLine,
  presenceHoldUntil,
  readDuePresenceCalls,
  useCodeAttempt,
  readFamilyCodeSeed,
  readPresenceAskFacts,
  readPresenceCheck,
  readPresenceChecks,
  readPresenceLine,
  readPresenceStatus,
  readPresenceSummary,
  readTrustedVoices,
  readVoiceConfirmation,
  recordPresenceAsked,
  recordPresenceCallSid,
  reissueVoiceConfirmation,
  removeTrustedVoice,
  setVoiceAliases,
  startPresenceCall,
  sweepPresenceChecks,
  type PresenceAlerts,
  type PresenceCheckInput,
} from "./presence.ts";
import { asPerson, asService } from "./scope.ts";
import { proposeHelp } from "./presence-help.ts";
import { PARENT_PHONE, adminRun, enableCalls, realCircle, seatPerson, serviceRows, snapshotFor, visitorWithCircle, withoutTriggers, type VisitorCircle } from "./testing/index.ts";
import { testDatabases } from "./testing/databases.ts";
import { REFUSED, errorCode } from "./testing/sql.ts";

const db = testDatabases();

const ALERTS: PresenceAlerts = {
  denied: "Someone saying they were Theo asked Rose for $2,000. Theo says it was not them. Treat it as a scam.",
  unreachable: "Someone saying they were Theo asked Rose for $2,000. I could not reach Theo.",
  confirmed: "Theo says it really was them asking Rose for $2,000. Nothing has been paid.",
  unknown: "Someone saying they were Mike asked Rose for $900. That person is not among those Kin may ask.",
};

async function theo(circle: VisitorCircle): Promise<string> {
  const [voice] = (await asPerson(db.app, circle.userId, (tx) => readTrustedVoices(tx, circle.circleId))).filter((each) => each.name === "Theo");
  if (!voice) throw new Error("The demo circle has no Theo");
  return voice.id;
}

function input(circle: VisitorCircle, voiceId: string | null, change: Partial<PresenceCheckInput> = {}): PresenceCheckInput {
  return {
    circleId: circle.circleId,
    voiceId,
    claimedName: voiceId === null ? "Mike" : "Theo",
    claimedRelationship: voiceId === null ? "nephew" : "grandson",
    claimedCents: 200_000,
    markers: ["secrecy", "urgency", "gift_cards"],
    said: ["Grandma it's Theo, I need $2,000 for bail today, don't tell Mum, buy gift cards."],
    locale: "en",
    token: newCheckToken(),
    alerts: ALERTS,
    ...change,
  };
}

const open = (circle: VisitorCircle, userId: string, check: PresenceCheckInput) => asPerson(db.app, userId, (tx) => openPresenceCheck(tx, check));
/** The claim checks written for a circle, oldest first; the bigint column reads back as text, so it is turned into a number. */
const claimChecks = async (circleId: string) =>
  (await serviceRows(db, circleId, "select verdict, claimed_cents from claim_checks order by created_at")).map((row) => ({ verdict: row["verdict"], claimed_cents: row["claimed_cents"] === null ? null : Number(row["claimed_cents"]) }));

describe("opening a check in a demo circle", () => {
  it("asks the stand-in at once, holds outgoing money and writes nothing the family sees until someone answers", async () => {
    const circle = await visitorWithCircle(db);
    const voice = await theo(circle);
    const check = input(circle, voice);
    const opened = await open(circle, circle.userId, check);
    expect(opened).toMatchObject({ state: "asked", simulated: true, repeated: false });

    const [record] = await asPerson(db.app, circle.userId, (tx) => readPresenceChecks(tx, circle.circleId));
    expect(record).toMatchObject({ id: opened.checkId, state: "asked", voiceId: voice, claimedCents: 200_000, simulated: true, source: "app" });
    expect(record?.markers).toEqual(["secrecy", "urgency", "gift_cards"]);
    expect(record?.holdUntil).not.toBeNull();
    expect(await asService(db.service, circle.circleId, (tx) => presenceHoldUntil(tx, circle.circleId, new Date()))).not.toBeNull();
    expect(await claimChecks(circle.circleId)).toHaveLength(1);
    // A demo circle texts nobody.
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from outbox where topic = 'presence.ask'")).toEqual([{ n: 0 }]);
  });

  it("raises the alert at once, and asks nobody, when the claimed person is not on the list", async () => {
    const circle = await visitorWithCircle(db);
    const opened = await open(circle, circle.userId, input(circle, null));
    expect(opened.state).toBe("unanswered");
    expect((await claimChecks(circle.circleId)).at(-1)).toEqual({ verdict: "no_match", claimed_cents: 200_000 });
    // Everyone who sees the circle's money (the organizer, two contributors, the parent and the observer) is told in the words worked out for it.
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from narrations where topic = 'falseDemand' and spoken_text = $1", [ALERTS.unknown])).toEqual([{ n: 5 }]);
  });

  it("stores each check once per phone call and refuses a person who is not on the list or is another circle's", async () => {
    const circle = await visitorWithCircle(db);
    const other = await visitorWithCircle(db);
    const voice = await theo(circle);
    const call = (callSid: string, circleId = circle.circleId) => asService(db.service, circleId, (tx) => openPresenceCheckByLine(tx, { ...input(circle, voice, { circleId }), callSid, from: null }));
    const first = await call("CA00000000000000000000000000000001");
    const again = await call("CA00000000000000000000000000000001");
    expect(again).toMatchObject({ checkId: first.checkId, repeated: true });
    expect(await serviceRows(db, circle.circleId, "select source from presence_checks where call_sid is not null")).toEqual([{ source: "phone" }]);
    // The service names one circle; any other is refused, and so is a person who belongs to a different circle.
    await expect(asService(db.service, other.circleId, (tx) => openPresenceCheckByLine(tx, { ...input(circle, voice), callSid: "CA00000000000000000000000000000002", from: null }))).rejects.toMatchObject({ reason: "refused" });
    await expect(open(circle, circle.userId, input(circle, await theo(other)))).rejects.toMatchObject({ reason: "cannot_ask" });
  });

  it("keeps a payment app among the scam signs, and refuses a sign the rules do not know", async () => {
    const circle = await visitorWithCircle(db);
    const { checkId } = await open(circle, circle.userId, input(circle, await theo(circle), { markers: ["urgency", "payment_app"] }));
    expect(await asPerson(db.app, circle.userId, (tx) => readPresenceCheck(tx, circle.circleId, checkId))).toMatchObject({ markers: ["urgency", "payment_app"] });
    await expect(open(circle, circle.userId, input(circle, await theo(circle), { markers: ["urgency", "bogus" as never] }))).rejects.toMatchObject({ reason: "invalid" });
  });

  it("is open to the organizer, a contributor and the parent, never to a caregiver or an observer, and a flood is refused", async () => {
    const circle = await visitorWithCircle(db);
    const voice = await theo(circle);
    const [marcus, rose, amara, daniel] = await Promise.all(["marcus", "rose", "amara", "daniel"].map((key) => seatPerson(db, circle.circleId, circle.members[key as "marcus"])));
    for (const userId of [marcus, rose]) expect((await open(circle, userId as string, input(circle, voice))).state).toBe("asked");
    for (const userId of [amara, daniel]) await expect(open(circle, userId as string, input(circle, voice))).rejects.toMatchObject({ reason: "refused" });
    // Two checks are open already; a circle may open six an hour, since each one texts a real person.
    for (let each = 0; each < 4; each += 1) await open(circle, circle.userId, input(circle, voice));
    await expect(open(circle, circle.userId, input(circle, voice))).rejects.toMatchObject({ reason: "rate_limited" });
  });
});

describe("the real person's answer", () => {
  it("holds money for a day and tells the family on a 'no', counts it as stopped, and refuses a 'yes' after it", async () => {
    const circle = await visitorWithCircle(db);
    const token = newCheckToken();
    const { checkId } = await open(circle, circle.userId, input(circle, await theo(circle), { token }));

    expect(await readPresenceStatus(db.app, token)).toMatchObject({ state: "asked", voiceFirstName: "Theo", parentFirstName: "Rose", claimedCents: 200_000, currency: "USD", canAnswer: true });
    expect(await answerPresenceCheck(db.app, { token, answer: "not_me" })).toEqual({ state: "denied", changed: true });
    // The same answer again changes nothing and says so; a 'yes' after a 'no' is refused.
    expect(await answerPresenceCheck(db.app, { token, answer: "not_me" })).toEqual({ state: "denied", changed: false });
    await expect(answerPresenceCheck(db.app, { token, answer: "me" })).rejects.toMatchObject({ reason: "wrong_state" });

    const record = await asPerson(db.app, circle.userId, (tx) => readPresenceCheck(tx, circle.circleId, checkId));
    expect(record).toMatchObject({ state: "denied" });
    const hold = record?.holdUntil?.getTime() ?? 0;
    expect(hold - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect(await claimChecks(circle.circleId)).toContainEqual({ verdict: "no_match", claimed_cents: 200_000 });
    expect(await asPerson(db.app, circle.userId, (tx) => readPresenceSummary(tx, circle.circleId, new Date().toISOString().slice(0, 7)))).toMatchObject({ denied: 1, stoppedCents: 200_000 });
    // Every member who sees the money is told, in the words worked out when the check was opened.
    const told = await serviceRows(db, circle.circleId, "select distinct spoken_text from narrations where claim_check_id is not null and spoken_text like 'Someone saying they were Theo%'");
    expect(told).toEqual([{ spoken_text: ALERTS.denied }]);
  });

  it("puts the hold on the circle every screen reads, a day long on the circle's own clock, and nothing before any check", async () => {
    const circle = await visitorWithCircle(db);
    const heldUntil = async () => (await snapshotFor(db, circle.userId, circle.circleId)).circle;
    expect((await heldUntil()).heldByPresenceUntil).toBeNull();
    const token = newCheckToken();
    await open(circle, circle.userId, input(circle, await theo(circle), { token }));
    const open15 = await heldUntil();
    const openLeft = (open15.heldByPresenceUntil?.getTime() ?? 0) - open15.now.getTime();
    expect(openLeft).toBeGreaterThan(0);
    expect(openLeft).toBeLessThanOrEqual(3_600_000);
    await answerPresenceCheck(db.app, { token, answer: "not_me" });
    const denied = await heldUntil();
    // A demo circle's clock stands still, so the hold is counted from it: about a day after its "now".
    const deniedLeft = (denied.heldByPresenceUntil?.getTime() ?? 0) - denied.now.getTime();
    expect(deniedLeft).toBeGreaterThan(23 * 3_600_000);
    // The database times the hold on its own clock and this test reads it on Node's: allow a minute between the two.
    expect(deniedLeft).toBeLessThanOrEqual(24 * 3_600_000 + 60_000);
  });

  it("lifts the hold on a 'yes', tells the family nothing has moved, and lets a later 'no' overrule it", async () => {
    const circle = await visitorWithCircle(db);
    const token = newCheckToken();
    await open(circle, circle.userId, input(circle, await theo(circle), { token }));
    expect(await answerPresenceCheck(db.app, { token, answer: "me" })).toEqual({ state: "confirmed", changed: true });
    expect(await asService(db.service, circle.circleId, (tx) => presenceHoldUntil(tx, circle.circleId, new Date()))).toBeNull();
    expect(await answerPresenceCheck(db.app, { token, answer: "not_me" })).toEqual({ state: "denied", changed: true });
    expect(await asService(db.service, circle.circleId, (tx) => presenceHoldUntil(tx, circle.circleId, new Date()))).not.toBeNull();
  });

  it("shows a link that ran out as closed, refuses its answer, and refuses every link that never existed the same way", async () => {
    const circle = await visitorWithCircle(db);
    const token = newCheckToken();
    await open(circle, circle.userId, input(circle, await theo(circle), { token }));
    await withoutTriggers(db, (run) => run(sql`update presence_checks set expires_at = now() - interval '1 minute' where token_hash = ${hashCheckToken(token)}`));
    // The page can still say "this question has run out", but the answer no longer counts.
    expect(await readPresenceStatus(db.app, token)).toMatchObject({ state: "asked", canAnswer: false });
    for (const dead of [newCheckToken(), token, "not-a-token"]) {
      await expect(answerPresenceCheck(db.app, { token: dead, answer: "me" })).rejects.toMatchObject({ reason: "refused" });
    }
    for (const unknown of [newCheckToken(), "not-a-token"]) await expect(readPresenceStatus(db.app, unknown)).rejects.toMatchObject({ reason: "refused" });
  });
});

describe("a real circle", () => {
  it("queues a text carrying the link, drops the link from the queue once it is sent, and gives up after ninety seconds", async () => {
    const circle = await realCircle(db);
    const added = await asPerson(db.app, circle.userId, (tx) => addTrustedVoice(tx, { circleId: circle.circleId, name: "Theo", relationship: "grandson", phone: "+15555550188", locale: "en", token: newCheckToken() }));
    expect(added).toMatchObject({ simulated: false, confirmed: false });
    // A person who has not confirmed their number is never asked.
    await expect(open(circle, circle.userId, input(circle, added.id))).rejects.toMatchObject({ reason: "cannot_ask" });
    // The person confirms from their own phone (tested below); here the number is simply confirmed.
    await db.admin.execute(sql`update trusted_voices set confirmed_at = now() where id = ${added.id}`);

    const token = newCheckToken();
    const opened = await open(circle, circle.userId, input(circle, added.id, { token }));
    expect(opened).toMatchObject({ state: "opened", simulated: false });
    const [message] = (await claimOutbox(db.service, PRESENCE_ASK_TOPIC, 5, 60)).filter((each) => each.circleId === circle.circleId);
    expect(message?.payload).toMatchObject({ checkId: opened.checkId, token });

    const facts = await asService(db.service, circle.circleId, (tx) => readPresenceAskFacts(tx, circle.circleId, opened.checkId));
    expect(facts).toMatchObject({ phone: "+15555550188", voiceName: "Theo", parentName: "Rose", state: "opened" });
    await asService(db.service, circle.circleId, (tx) => recordPresenceAsked(tx, circle.circleId, opened.checkId, `SM${"a".repeat(32)}`));
    expect(await serviceRows(db, circle.circleId, "select state from presence_checks where id = $1", [opened.checkId])).toEqual([{ state: "asked" }]);
    expect(await serviceRows(db, circle.circleId, "select payload ? 'token' as has from outbox where topic = 'presence.ask'")).toEqual([{ has: false }]);

    // Nobody answers. Ninety seconds after the text, the check ends "could not be reached" and the family is told.
    await withoutTriggers(db, (run) => run(sql`update presence_checks set asked_at = now() - interval '2 minutes' where id = ${opened.checkId}`));
    expect(await sweepPresenceChecks(db.service)).toBeGreaterThanOrEqual(1);
    expect(await serviceRows(db, circle.circleId, "select state from presence_checks where id = $1", [opened.checkId])).toEqual([{ state: "unanswered" }]);
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from narrations where spoken_text = $1", [ALERTS.unreachable])).toEqual([{ n: 5 }]);
    // Late, a 'no' still counts; when the link finally runs out the hold ends.
    await withoutTriggers(db, (run) => run(sql`update presence_checks set expires_at = now() - interval '1 second' where id = ${opened.checkId}`));
    await sweepPresenceChecks(db.service);
    expect(await serviceRows(db, circle.circleId, "select state, hold_until from presence_checks where id = $1", [opened.checkId])).toEqual([{ state: "expired", hold_until: null }]);
    expect(await asService(db.service, circle.circleId, (tx) => presenceHoldUntil(tx, circle.circleId, new Date()))).toBeNull();
  });

  it("lets a family member confirm their own number from the link in a text, once, with nobody signed in", async () => {
    const circle = await realCircle(db);
    const token = newCheckToken();
    const added = await asPerson(db.app, circle.userId, (tx) => addTrustedVoice(tx, { circleId: circle.circleId, name: "Mia Okafor", relationship: "granddaughter", phone: "+15555550199", locale: "fr", token }));
    const [message] = (await claimOutbox(db.service, PRESENCE_CONFIRM_TOPIC, 20, 60)).filter((each) => each.circleId === circle.circleId);
    expect(message?.payload).toMatchObject({ voiceId: added.id, token });
    expect(await readVoiceConfirmation(db.app, token)).toEqual({ name: "Mia", parentFirstName: "Rose", confirmed: false });
    expect(await confirmTrustedVoice(db.app, token)).toMatchObject({ confirmed: true });
    const line = await asService(db.service, circle.circleId, (tx) => readPresenceLine(tx, circle.circleId));
    expect(line?.voices.map((each) => each.name)).toContain("Mia Okafor");
    // The link is spent: it no longer opens anything.
    await expect(readVoiceConfirmation(db.app, token)).rejects.toBeInstanceOf(PresenceError);
  });
});

describe("who can see or change what", () => {
  it("lets the organizer and the parent manage the list, and nobody else, and keeps phones and links from the app's role", async () => {
    const circle = await visitorWithCircle(db);
    const marcus = await seatPerson(db, circle.circleId, circle.members.marcus);
    const rose = await seatPerson(db, circle.circleId, circle.members.rose);
    const add = (userId: string, phone: string) => asPerson(db.app, userId, (tx) => addTrustedVoice(tx, { circleId: circle.circleId, name: "Mia", relationship: "granddaughter", phone, locale: "en", token: newCheckToken() }));
    await expect(add(marcus, "+15555550101")).rejects.toMatchObject({ reason: "refused" });
    await add(rose, "+15555550102");
    await expect(add(circle.userId, "+15555550102")).rejects.toMatchObject({ reason: "duplicate" });
    await expect(asPerson(db.app, marcus, (tx) => removeTrustedVoice(tx, circle.circleId, "00000000-0000-0000-0000-000000000000"))).rejects.toMatchObject({ reason: "refused" });

    // The app's role never reads a number or a link's hash, even for its own circle.
    for (const text of ["select phone from trusted_voices", "select confirm_token_hash from trusted_voices", "select token_hash from presence_checks", "select ask_message_sid from presence_checks"]) {
      expect(await errorCode(asPerson(db.app, circle.userId, (tx) => tx.execute(sql.raw(text))))).toBe(REFUSED.permission);
    }
    // And it writes nothing directly: only the operations do.
    expect(await errorCode(asPerson(db.app, circle.userId, (tx) => tx.execute(sql`update presence_checks set state = 'confirmed'`)))).toBe(REFUSED.permission);
  });

  it("hides another circle's checks and voices from a person, a caregiver's own circle's from the caregiver, and another circle's from the service", async () => {
    const circle = await visitorWithCircle(db);
    const other = await visitorWithCircle(db);
    await open(circle, circle.userId, input(circle, await theo(circle)));
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const count = (userId: string, circleId: string, table: string) => asPerson(db.app, userId, async (tx) => Number((await tx.execute<{ n: string }>(sql`select count(*) as n from ${sql.identifier(table)} where circle_id = ${circleId}`)).rows[0]?.n));
    for (const table of ["presence_checks", "trusted_voices"]) {
      expect(await count(other.userId, circle.circleId, table)).toBe(0);
      expect(await count(amara, circle.circleId, table)).toBe(0);
      expect(await count(circle.userId, circle.circleId, table)).toBeGreaterThan(0);
    }
    expect(await asService(db.service, other.circleId, (tx) => readPresenceChecks(tx, circle.circleId))).toEqual([]);
  });
});

const NOW = new Date("2026-10-30T18:00:00Z");
const NOTE = "Help for Theo, after Theo confirmed the request. It goes only to Theo’s own PayPal account.";

async function confirmedCheck(circle: VisitorCircle, change: Partial<PresenceCheckInput> = {}): Promise<string> {
  const token = newCheckToken();
  const { checkId } = await open(circle, circle.userId, input(circle, await theo(circle), { token, ...change }));
  await answerPresenceCheck(db.app, { token, answer: "me" });
  return checkId;
}
const help = (circle: VisitorCircle, userId: string, checkId: string, cents = 50_000, now = NOW) => asPerson(db.app, userId, (tx) => proposeHelp(tx, { circleId: circle.circleId, checkId, cents, note: NOTE, now }));

describe("other spellings and a confirmed account", () => {
  it("keeps the other ways a name is written, shows the app whether an account is confirmed and never which", async () => {
    const circle = await visitorWithCircle(db);
    const [voice] = await asPerson(db.app, circle.userId, (tx) => readTrustedVoices(tx, circle.circleId));
    expect(voice).toMatchObject({ name: "Theo", aliases: ["תיאו", "ثيو"], accountConfirmed: true });
    expect(JSON.stringify(voice)).not.toContain("example.com");
    await asPerson(db.app, circle.userId, (tx) => setVoiceAliases(tx, circle.circleId, voice?.id ?? "", ["Teddy"]));
    expect((await asPerson(db.app, circle.userId, (tx) => readTrustedVoices(tx, circle.circleId)))[0]?.aliases).toEqual(["Teddy"]);
    for (const aliases of [["a", "b", "c", "d", "e", "f"], [" "], ["x".repeat(81)]]) {
      await expect(asPerson(db.app, circle.userId, (tx) => setVoiceAliases(tx, circle.circleId, voice?.id ?? "", aliases))).rejects.toBeInstanceOf(Error);
    }
    const marcus = await seatPerson(db, circle.circleId, circle.members.marcus);
    await expect(asPerson(db.app, marcus, (tx) => setVoiceAliases(tx, circle.circleId, voice?.id ?? "", ["Teo"]))).rejects.toMatchObject({ reason: "refused" });
    expect(await errorCode(asPerson(db.app, circle.userId, (tx) => tx.execute(sql`select paypal_receiver from trusted_voices`)))).toBe(REFUSED.permission);
  });

  it("takes the person's own PayPal account from their link, once, and lets a fresh link change it", async () => {
    const circle = await realCircle(db);
    const first = newCheckToken();
    const added = await asPerson(db.app, circle.userId, (tx) => addTrustedVoice(tx, { circleId: circle.circleId, name: "Mia", relationship: "granddaughter", phone: "+15555550155", locale: "en", token: first, aliases: ["ميا"] }));
    await confirmTrustedVoice(db.app, first, "  Mia@Personal.Example.com ");
    expect(await serviceRows(db, circle.circleId, "select paypal_receiver, receiver_confirmed_at is not null as set from trusted_voices where id = $1", [added.id])).toEqual([{ paypal_receiver: "mia@personal.example.com", set: true }]);
    await expect(confirmTrustedVoice(db.app, first)).rejects.toBeInstanceOf(PresenceError);
    const second = newCheckToken();
    await asPerson(db.app, circle.userId, (tx) => reissueVoiceConfirmation(tx, circle.circleId, added.id, second));
    await confirmTrustedVoice(db.app, second, "mia.new@personal.example.com");
    expect(await serviceRows(db, circle.circleId, "select paypal_receiver from trusted_voices where id = $1", [added.id])).toEqual([{ paypal_receiver: "mia.new@personal.example.com" }]);
    const third = newCheckToken();
    await asPerson(db.app, circle.userId, (tx) => reissueVoiceConfirmation(tx, circle.circleId, added.id, third));
    await expect(confirmTrustedVoice(db.app, third, "not an email")).rejects.toBeInstanceOf(PresenceError);
  });
});

describe("help for someone who said it was really them", () => {
  it("raises one ordinary payout proposal to a payee made from the account the person confirmed, with the family's words on it", async () => {
    const circle = await visitorWithCircle(db);
    const checkId = await confirmedCheck(circle);
    const proposalId = await help(circle, circle.userId, checkId);
    expect(await serviceRows(db, circle.circleId, "select kind::text as kind, purpose, state::text as state, cents, note, raised_by, plan -> 'announceToCircle' as announce from proposals where id = $1", [proposalId])).toEqual([
      { kind: "caregiver_payout", purpose: "family_help", state: "pending_approval", cents: "50000", note: NOTE, raised_by: circle.members.elena, announce: true },
    ]);
    expect(await serviceRows(db, circle.circleId, "select y.name, y.category, y.paypal_receiver, y.payout_wallet::text as wallet, y.member_id from proposals p join payees y on y.id = p.payee_id where p.id = $1", [proposalId])).toEqual([
      { name: "Theo", category: "family_help", paypal_receiver: "theo@personal.example.com", wallet: "paypal", member_id: null },
    ]);
    expect((await asPerson(db.app, circle.userId, (tx) => readPresenceCheck(tx, circle.circleId, checkId)))?.helpProposalId).toBe(proposalId);
  });

  it("is raised once per check, only after a 'yes', for no more than was asked, and never by a caregiver or an observer", async () => {
    const circle = await visitorWithCircle(db);
    const token = newCheckToken();
    const { checkId: asked } = await open(circle, circle.userId, input(circle, await theo(circle), { token }));
    await expect(help(circle, circle.userId, asked)).rejects.toMatchObject({ reason: "not_confirmed" });
    await answerPresenceCheck(db.app, { token, answer: "me" });
    await expect(help(circle, circle.userId, asked, 200_001)).rejects.toMatchObject({ reason: "above_asked" });
    for (const cents of [0, -5, 1.5]) await expect(help(circle, circle.userId, asked, cents)).rejects.toMatchObject({ reason: "invalid" });
    const [amara, daniel] = await Promise.all([seatPerson(db, circle.circleId, circle.members.amara), seatPerson(db, circle.circleId, circle.members.daniel)]);
    for (const userId of [amara, daniel]) await expect(help(circle, userId, asked)).rejects.toMatchObject({ reason: "refused" });
    await help(circle, circle.userId, asked);
    await expect(help(circle, circle.userId, asked)).rejects.toMatchObject({ reason: "not_confirmed" });
    // A person who said "not me" can never be helped from that check.
    const denied = newCheckToken();
    const { checkId } = await open(circle, circle.userId, input(circle, await theo(circle), { token: denied }));
    await answerPresenceCheck(db.app, { token: denied, answer: "not_me" });
    await expect(help(circle, circle.userId, checkId)).rejects.toMatchObject({ reason: "not_confirmed" });
  });

  it("is refused when the person never confirmed an account, and when the list no longer holds them", async () => {
    const circle = await realCircle(db);
    const added = await asPerson(db.app, circle.userId, (tx) => addTrustedVoice(tx, { circleId: circle.circleId, name: "Theo", relationship: "grandson", phone: "+15555550166", locale: "en", token: newCheckToken() }));
    await adminRun(db, "update trusted_voices set confirmed_at = now() where id = $1", [added.id]);
    const token = newCheckToken();
    const { checkId } = await open(circle, circle.userId, input(circle, added.id, { token }));
    await answerPresenceCheck(db.app, { token, answer: "me" });
    await expect(help(circle, circle.userId, checkId)).rejects.toMatchObject({ reason: "no_account" });
    await asPerson(db.app, circle.userId, (tx) => removeTrustedVoice(tx, circle.circleId, added.id));
    await expect(help(circle, circle.userId, checkId)).rejects.toMatchObject({ reason: "no_account" });
  });

  it("can be paid to one address only: the database refuses any other on a help payee, any payee claiming to be one without a person, and a change of who it is", async () => {
    const circle = await visitorWithCircle(db);
    const proposalId = await help(circle, circle.userId, await confirmedCheck(circle));
    const [payee] = (await serviceRows(db, circle.circleId, "select payee_id from proposals where id = $1", [proposalId])) as { payee_id: string }[];
    const attempt = (text: string, params: unknown[] = []) => errorCode(serviceRows(db, circle.circleId, text, params));
    expect(await attempt("update payees set paypal_receiver = 'scammer@example.com' where id = $1", [payee?.payee_id])).toBe(REFUSED.check);
    expect(await attempt("update payees set payout_wallet = 'venmo' where id = $1", [payee?.payee_id])).toBe(REFUSED.check);
    expect(await attempt("update payees set category = 'care', voice_id = null where id = $1", [payee?.payee_id])).toBe(REFUSED.check);
    expect(await attempt("insert into payees (id, circle_id, name, category, paypal_receiver) values (gen_random_uuid(), $1, 'Cash', 'family_help', 'x@example.com')", [circle.circleId])).toBe(REFUSED.check);
    expect(await attempt("update payees set voice_id = (select id from trusted_voices where circle_id = $1 limit 1) where id = $2 and category <> 'family_help'", [circle.circleId, circle.payees.amara])).toBe(REFUSED.check);
    // The caregiver's own address route does not reach a help payee either.
    expect(await errorCode(asPerson(db.app, circle.userId, (tx) => tx.execute(sql`select kin_private.set_caregiver_receiver(${circle.circleId}::uuid, ${payee?.payee_id}::uuid, 'scammer@example.com')`)))).not.toBe("no error");
  });

  it("does not let a new confirmed account redirect help that is already moving", async () => {
    const circle = await realCircle(db);
    const first = newCheckToken();
    const added = await asPerson(db.app, circle.userId, (tx) => addTrustedVoice(tx, { circleId: circle.circleId, name: "Theo", relationship: "grandson", phone: "+15555550133", locale: "en", token: first }));
    await confirmTrustedVoice(db.app, first, "theo@personal.example.com");
    const token = newCheckToken();
    const { checkId } = await open(circle, circle.userId, input(circle, added.id, { token }));
    await answerPresenceCheck(db.app, { token, answer: "me" });
    // A real circle's clock is the database's own, so its plan is made for now.
    await help(circle, circle.userId, checkId, 50_000, new Date());
    const again = newCheckToken();
    await asPerson(db.app, circle.userId, (tx) => reissueVoiceConfirmation(tx, circle.circleId, added.id, again));
    await expect(confirmTrustedVoice(db.app, again, "someone.else@personal.example.com")).rejects.toMatchObject({ reason: "in_progress" });
  });
});

describe("the weekly family code", () => {
  it("gives the organizer, a contributor and the parent the same seed, made once, and nobody else", async () => {
    const circle = await visitorWithCircle(db);
    const other = await visitorWithCircle(db);
    const seed = await asPerson(db.app, circle.userId, (tx) => readFamilyCodeSeed(tx, circle.circleId));
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    const [marcus, rose, amara, daniel] = await Promise.all(["marcus", "rose", "amara", "daniel"].map((key) => seatPerson(db, circle.circleId, circle.members[key as "marcus"])));
    for (const userId of [marcus, rose]) expect(await asPerson(db.app, userId as string, (tx) => readFamilyCodeSeed(tx, circle.circleId))).toBe(seed);
    for (const userId of [amara, daniel]) await expect(asPerson(db.app, userId as string, (tx) => readFamilyCodeSeed(tx, circle.circleId))).rejects.toMatchObject({ reason: "refused" });
    expect(await asService(db.service, circle.circleId, (tx) => readFamilyCodeSeed(tx, circle.circleId))).toBe(seed);
    expect(await asPerson(db.app, other.userId, (tx) => readFamilyCodeSeed(tx, other.circleId))).not.toBe(seed);
    await expect(asPerson(db.app, other.userId, (tx) => readFamilyCodeSeed(tx, circle.circleId))).rejects.toMatchObject({ reason: "refused" });
    await expect(asService(db.service, other.circleId, (tx) => readFamilyCodeSeed(tx, circle.circleId))).rejects.toMatchObject({ reason: "refused" });
    expect(await errorCode(asPerson(db.app, circle.userId, (tx) => tx.execute(sql`select seed from family_codes`)))).toBe(REFUSED.permission);
  });
});

describe("Kin's call to the real person", () => {
  async function askedReal(): Promise<{ circle: Awaited<ReturnType<typeof realCircle>>; checkId: string }> {
    const circle = await realCircle(db);
    const added = await asPerson(db.app, circle.userId, (tx) => addTrustedVoice(tx, { circleId: circle.circleId, name: "Theo", relationship: "grandson", phone: "+15555550144", locale: "en", token: newCheckToken() }));
    await adminRun(db, "update trusted_voices set confirmed_at = now() where id = $1", [added.id]);
    const { checkId } = await open(circle, circle.userId, input(circle, added.id));
    await asService(db.service, circle.circleId, (tx) => recordPresenceAsked(tx, circle.circleId, checkId, `SM${"b".repeat(32)}`));
    return { circle, checkId };
  }
  const SID = `CA${"c".repeat(32)}`;

  it("is due thirty seconds after the text, committed before the dial so the person is rung once, and answers only through the call recorded for this check", async () => {
    const { circle, checkId } = await askedReal();
    expect((await readDuePresenceCalls(db.service)).filter((each) => each.checkId === checkId)).toEqual([]);
    await withoutTriggers(db, (run) => run(sql`update presence_checks set asked_at = now() - interval '40 seconds' where id = ${checkId}`));
    expect(await readDuePresenceCalls(db.service)).toContainEqual({ circleId: circle.circleId, checkId });

    const facts = await asService(db.service, circle.circleId, (tx) => startPresenceCall(tx, circle.circleId, checkId));
    expect(facts).toEqual({ phone: "+15555550144", locale: "en", name: "Theo", parentName: "Rose", claimedCents: 200_000, currency: "USD" });
    // A second worker, or a retry after a crash, is told there is nothing to do.
    expect(await asService(db.service, circle.circleId, (tx) => startPresenceCall(tx, circle.circleId, checkId))).toBeNull();
    expect((await readDuePresenceCalls(db.service)).filter((each) => each.checkId === checkId)).toEqual([]);

    const answer = (callSid: string, answer: "me" | "not_me") => asService(db.service, circle.circleId, (tx) => answerPresenceCheckByCall(tx, { circleId: circle.circleId, checkId, callSid, answer }));
    await expect(answer(SID, "not_me")).rejects.toMatchObject({ reason: "refused" });
    await asService(db.service, circle.circleId, (tx) => recordPresenceCallSid(tx, circle.circleId, checkId, SID));
    await expect(answer(`CA${"d".repeat(32)}`, "not_me")).rejects.toMatchObject({ reason: "refused" });
    expect(await answer(SID, "not_me")).toEqual({ state: "denied", changed: true });
    expect(await serviceRows(db, circle.circleId, "select state, answered_via from presence_checks where id = $1", [checkId])).toEqual([{ state: "denied", answered_via: "call" }]);
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from narrations where spoken_text = $1", [ALERTS.denied])).toEqual([{ n: 5 }]);
    // The id of a call is kept once and never swapped for another.
    await asService(db.service, circle.circleId, (tx) => recordPresenceCallSid(tx, circle.circleId, checkId, `CA${"e".repeat(32)}`));
    expect(await serviceRows(db, circle.circleId, "select ask_call_sid from presence_checks where id = $1", [checkId])).toEqual([{ ask_call_sid: SID }]);
  });

  it("is never placed for a demo's stand-in, an answered check or another circle's, and no person can start one", async () => {
    const demo = await visitorWithCircle(db);
    await open(demo, demo.userId, input(demo, await theo(demo)));
    expect((await readDuePresenceCalls(db.service)).filter((each) => each.circleId === demo.circleId)).toEqual([]);
    const { circle, checkId } = await askedReal();
    await expect(asService(db.service, demo.circleId, (tx) => startPresenceCall(tx, circle.circleId, checkId))).rejects.toMatchObject({ reason: "refused" });
    expect(await errorCode(asPerson(db.app, circle.userId, (tx) => tx.execute(sql`select kin_private.start_presence_call(${circle.circleId}::uuid, ${checkId}::uuid)`)))).toBe(REFUSED.permission);
    expect(await errorCode(asPerson(db.app, circle.userId, (tx) => tx.execute(sql`select * from kin_private.due_presence_calls()`)))).toBe(REFUSED.permission);
  });
});

describe("what a stranger can make the presence line do", () => {
  async function lineCircle() {
    const circle = await realCircle(db);
    await enableCalls(db, circle);
    const added = await asPerson(db.app, circle.userId, (tx) => addTrustedVoice(tx, { circleId: circle.circleId, name: "Theo", relationship: "grandson", phone: "+15555550123", locale: "en", token: newCheckToken() }));
    await adminRun(db, "update trusted_voices set confirmed_at = now() where id = $1", [added.id]);
    const call = (n: number, from: string | null, token = newCheckToken()) =>
      asService(db.service, circle.circleId, (tx) => openPresenceCheckByLine(tx, { ...input(circle, added.id, { token }), callSid: `CA${String(n).padStart(32, "0")}`, from }));
    const held = () => asService(db.service, circle.circleId, (tx) => presenceHoldUntil(tx, circle.circleId, new Date()));
    return { circle, call, held };
  }

  it("holds outgoing money for a call from the parent's own number, and for no one else's", async () => {
    const stranger = await lineCircle();
    expect(await stranger.call(1, "+15555550999")).toMatchObject({ fromParent: false, state: "opened" });
    expect(await stranger.call(2, null)).toMatchObject({ fromParent: false });
    expect(await stranger.held()).toBeNull();
    // The check still asks the real person and is still on the family's record: only the freeze is withheld.
    expect(await serviceRows(db, stranger.circle.circleId, "select count(*)::int as n from outbox where topic = 'presence.ask'")).toEqual([{ n: 2 }]);
    const parent = await lineCircle();
    expect(await parent.call(1, PARENT_PHONE)).toMatchObject({ fromParent: true });
    expect(await parent.held()).not.toBeNull();
  });

  it("never lets a stranger's check freeze the pool, even when the real person later says it was not them, and counts strangers apart from the parent", async () => {
    const { circle, call, held } = await lineCircle();
    const token = newCheckToken();
    const stranger = await call(1, "+15555550999", token);
    // The real person says "not me": the family is told, the check is closed, and no hold is made.
    await answerPresenceCheck(db.app, { token, answer: "not_me" });
    expect(await held()).toBeNull();
    expect(await serviceRows(db, circle.circleId, "select state, may_hold from presence_checks where id = $1", [stranger.checkId])).toEqual([{ state: "denied", may_hold: false }]);
    // Three strangers use up the strangers' calls; the parent's own are still taken.
    await call(2, "+15555550998");
    await call(3, "+15555550997");
    await expect(call(4, "+15555550996")).rejects.toMatchObject({ reason: "rate_limited" });
    expect(await call(5, PARENT_PHONE)).toMatchObject({ fromParent: true });
    expect(await held()).not.toBeNull();
    // A flag that says a check may not hold can never be turned back on.
    expect(await errorCode(adminRun(db, "update presence_checks set may_hold = true where id = $1", [stranger.checkId]))).toBe(REFUSED.restrict);
  });

  it("answers a call Twilio delivers twice with the same check and counts it once, and opens at most three an hour", async () => {
    const { call } = await lineCircle();
    const first = await call(1, null);
    expect(await call(1, null)).toMatchObject({ checkId: first.checkId, repeated: true });
    await call(2, null);
    await call(3, null);
    await expect(call(4, null)).rejects.toMatchObject({ reason: "rate_limited" });
  });

  it("lets the weekly code be put to a check's caller twice, by anyone who may, and refuses the rest", async () => {
    const circle = await visitorWithCircle(db);
    const { checkId } = await open(circle, circle.userId, input(circle, null));
    const marcus = await seatPerson(db, circle.circleId, circle.members.marcus);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const attempt = (userId: string) => asPerson(db.app, userId, (tx) => useCodeAttempt(tx, circle.circleId, checkId));
    expect(await attempt(circle.userId)).toBe(true);
    expect(await attempt(marcus)).toBe(true);
    expect(await attempt(circle.userId)).toBe(false);
    await expect(attempt(amara)).rejects.toMatchObject({ reason: "refused" });
    expect(await asService(db.service, circle.circleId, (tx) => useCodeAttempt(tx, circle.circleId, checkId))).toBe(false);
    await expect(asService(db.service, circle.circleId, (tx) => useCodeAttempt(tx, circle.circleId, "00000000-0000-0000-0000-000000000000"))).rejects.toMatchObject({ reason: "refused" });
    expect(await serviceRows(db, circle.circleId, "select code_attempts from presence_checks where id = $1", [checkId])).toEqual([{ code_attempts: 2 }]);
  });
});
