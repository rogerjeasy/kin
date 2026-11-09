import {
  PRESENCE_ASK_TOPIC,
  PRESENCE_CONFIRM_TOPIC,
  addTrustedVoice,
  asPerson,
  claimOutbox,
  newCheckToken,
  openPresenceCheck,
  readTrustedVoices,
} from "@kin/db";
import { adminRun, realCircle, serviceRows, testDatabases, type RealCircle } from "@kin/db/testing";
import { TextDeliveryError, fakeTextSender } from "@kin/notify";
import { describe, expect, it } from "vitest";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";
import { runPresenceBatch } from "./run-presence.ts";

const db = testDatabases();
const silent: InboxLog = () => {};
const WEB = "https://kin.example.com";
const ALERTS = { denied: "Denied.", unreachable: "Unreachable.", confirmed: "Confirmed.", unknown: "Unknown." };

async function confirmedVoice(circle: RealCircle, phone = "+15555550188"): Promise<string> {
  const added = await asPerson(db.app, circle.userId, (tx) => addTrustedVoice(tx, { circleId: circle.circleId, name: "Theo", relationship: "grandson", phone, locale: "en", token: newCheckToken() }));
  // The person confirmed from their own phone, so the confirmation text this test did not mean to send is already done with.
  await adminRun(db, "update trusted_voices set confirmed_at = now() where id = $1", [added.id]);
  await adminRun(db, "update outbox set sent_at = now() where circle_id = $1 and topic = 'presence.confirm'", [circle.circleId]);
  return added.id;
}

const ask = (circle: RealCircle, voiceId: string, token = newCheckToken()) =>
  asPerson(db.app, circle.userId, (tx) =>
    openPresenceCheck(tx, { circleId: circle.circleId, voiceId, claimedName: "Theo", claimedRelationship: "grandson", claimedCents: 200_000, markers: [], said: ["It's Theo, I need $2,000."], locale: "en", token, alerts: ALERTS }),
  );

/** Leaves the queue the way a fresh circle has it: other tests' messages are not this test's to send. */
const drain = async () => {
  for (const topic of [PRESENCE_ASK_TOPIC, PRESENCE_CONFIRM_TOPIC]) await claimOutbox(db.service, topic, 100, 10);
  await adminRun(db, "update outbox set sent_at = now() where topic in ('presence.ask', 'presence.confirm') and sent_at is null");
};

describe("texting the real person", () => {
  it("sends one text with the link to the person's own number, marks the check asked and forgets the link in the queue", async () => {
    await drain();
    const circle = await realCircle(db);
    const voice = await confirmedVoice(circle);
    const token = newCheckToken();
    const { checkId } = await ask(circle, voice, token);
    const texts = fakeTextSender();
    expect(await runPresenceBatch({ db: db.service, texts, webUrl: WEB }, silent)).toBe(1);
    expect(texts.sent).toHaveLength(1);
    expect(texts.sent[0]?.to).toBe("+15555550188");
    expect(texts.sent[0]?.body).toContain(`${WEB}/en/v/${token}`);
    expect(texts.sent[0]?.body).toContain("$2,000.00");
    expect(await serviceRows(db, circle.circleId, "select state, ask_message_sid is not null as sid from presence_checks where id = $1", [checkId])).toEqual([{ state: "asked", sid: true }]);
    expect(await serviceRows(db, circle.circleId, "select payload ? 'token' as has, sent_at is not null as sent from outbox where topic = 'presence.ask'")).toEqual([{ has: false, sent: true }]);
    // Nothing is left to send, so a second pass sends nothing.
    expect(await runPresenceBatch({ db: db.service, texts, webUrl: WEB }, silent)).toBe(0);
  });

  it("never texts a check that is over or whose person was removed, and drops the link either way", async () => {
    await drain();
    const circle = await realCircle(db);
    const voice = await confirmedVoice(circle);
    await ask(circle, voice);
    await adminRun(db, "update presence_checks set state = 'expired' where circle_id = $1", [circle.circleId]);
    const texts = fakeTextSender();
    await runPresenceBatch({ db: db.service, texts, webUrl: WEB }, silent);
    expect(texts.sent).toEqual([]);
    expect(await serviceRows(db, circle.circleId, "select payload ? 'token' as has, sent_at is not null as sent from outbox where topic = 'presence.ask'")).toEqual([{ has: false, sent: true }]);
  });

  it("tries again soon when Twilio is busy, never texts twice when it may already have sent one, and lets go of a number it cannot text", async () => {
    await drain();
    const circle = await realCircle(db);
    const voice = await confirmedVoice(circle);
    await ask(circle, voice);
    const texts = fakeTextSender();
    texts.failNext(new TextDeliveryError("rate_limited", { retryable: true, mayHaveBeenSent: false }));
    await runPresenceBatch({ db: db.service, texts, webUrl: WEB }, silent);
    expect(await serviceRows(db, circle.circleId, "select sent_at is null as waiting, payload ? 'token' as has from outbox where topic = 'presence.ask'")).toEqual([{ waiting: true, has: true }]);

    await adminRun(db, "update outbox set available_at = now() where topic = 'presence.ask' and sent_at is null");
    texts.failNext(new TextDeliveryError("network", { retryable: true, mayHaveBeenSent: true }));
    await runPresenceBatch({ db: db.service, texts, webUrl: WEB }, silent);
    expect(texts.sent).toEqual([]);
    expect(await serviceRows(db, circle.circleId, "select sent_at is not null as done, payload ? 'token' as has from outbox where topic = 'presence.ask'")).toEqual([{ done: true, has: false }]);
  });
});

describe("texting a confirmation link", () => {
  it("sends it once to the new family member's number and drops the link from the queue", async () => {
    await drain();
    const circle = await realCircle(db);
    const token = newCheckToken();
    await asPerson(db.app, circle.userId, (tx) => addTrustedVoice(tx, { circleId: circle.circleId, name: "Mia", relationship: "granddaughter", phone: "+15555550166", locale: "fr", token }));
    const texts = fakeTextSender();
    expect(await runPresenceBatch({ db: db.service, texts, webUrl: WEB }, silent)).toBe(1);
    expect(texts.sent[0]?.to).toBe("+15555550166");
    expect(texts.sent[0]?.body).toContain(`${WEB}/fr/t/${token}`);
    expect(await serviceRows(db, circle.circleId, "select payload ? 'token' as has from outbox where topic = 'presence.confirm'")).toEqual([{ has: false }]);
    expect((await asPerson(db.app, circle.userId, (tx) => readTrustedVoices(tx, circle.circleId))).find((each) => each.name === "Mia")).toMatchObject({ confirmed: false });
  });
});
