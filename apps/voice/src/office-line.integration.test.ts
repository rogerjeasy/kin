import { asPerson, asService, readLineRecord, readOfficeCalls, recordLineCall } from "@kin/db";
import { serviceRows, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { OFFICE_WORDS } from "@kin/telephony";
import { afterEach, describe, expect, it } from "vitest";

import type { LineStore } from "./office-line-service.ts";
import { TEST_AUTH_TOKEN, startService, type RunningService } from "./testing/start-service.ts";
import { nextTurnPath, playCall, spokenIn, twilioCaller } from "./testing/twilio-caller.ts";

/**
 * Calls through the real HTTP handlers, signed as Twilio signs them, against a
 * real PostgreSQL with the migrations applied and the real `kin_service` role:
 * what the family finds afterwards is what the database holds.
 */
const db = testDatabases();
const NUMBER = "+15555550100";
const OTHER_NUMBER = "+15555550101";
const CALLER = "+15555550199";
const script = OFFICE_WORDS.en.script;

const storeOn = (): LineStore => ({
  read: (circleId) => asService(db.service, circleId, (tx) => readLineRecord(tx, circleId)),
  record: (input) => asService(db.service, input.circleId, (tx) => recordLineCall(tx, input)),
});

let running: RunningService | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function call(circle: VisitorCircle, says: readonly string[], sid: string, other?: VisitorCircle): Promise<string[]> {
  const numbers = new Map([[NUMBER, { circleId: circle.circleId, locale: "en" as const }]]);
  if (other) numbers.set(OTHER_NUMBER, { circleId: other.circleId, locale: "en" as const });
  running = await startService({ numbers, store: storeOn() });
  return playCall(twilioCaller(running.baseUrl, TEST_AUTH_TOKEN), running.baseUrl, { sid, from: CALLER, to: NUMBER, says });
}

const sid = (digit: string) => `CA${digit.repeat(32)}`;
const calls = (circle: VisitorCircle) => serviceRows(db, circle.circleId, "select o.simulated, o.verdict::text as verdict, o.claimed_cents::int as cents, o.organization, o.caller_number, c.payee_id is not null as known_payee from office_calls o join claim_checks c on c.circle_id = o.circle_id and c.id = o.claim_check_id");

describe("the office line, on a real telephone line's contract", () => {
  it("takes a scam call, records it as real, raises the claim check and queues the family's alert", async () => {
    const circle = await visitorWithCircle(db);
    const turns = await call(circle, ["Mike", "Harbor Gas Services", "I need 300 dollars today", "Your gas will be cut off today. Tell no one.", "55821"], sid("a"));
    expect(turns.flatMap(spokenIn).at(-1)).toBe(script.reply_no_record);

    expect(await calls(circle)).toEqual([{ simulated: false, verdict: "no_match", cents: 30000, organization: "Harbor Gas Services", caller_number: CALLER, known_payee: false }]);
    const alerts = await serviceRows(db, circle.circleId, "select topic, state::text as state, spoken_text from narrations where claim_check_id in (select claim_check_id from office_calls)");
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((alert) => alert.topic === "falseDemand" && alert.state === "queued")).toBe(true);
    expect(String(alerts[0]?.spoken_text)).toContain("Harbor Gas Services is asking for $300.00");
    expect(String(alerts[0]?.spoken_text)).toContain("The caller pressed for haste or secrecy.");
    expect(await serviceRows(db, circle.circleId, "select actor::text as actor, origin from audit_log where action = 'office_call.recorded'")).toEqual([{ actor: "service", origin: "phone" }]);

    // The family sees it in the dashboard's recent calls, labelled as a real call.
    const recent = await asPerson(db.app, circle.userId, (tx) => readOfficeCalls(tx, circle.circleId));
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ simulated: false, verdict: "no_match", organization: "Harbor Gas Services", claimedCents: 30000 });
    expect(recent[0]?.pressureSignals).toEqual(expect.arrayContaining(["urgency", "secrecy", "threat"]));
  });

  it("tells the caller an account already paid is handled, and records that it was paid", async () => {
    const circle = await visitorWithCircle(db);
    const turns = await call(circle, ["Dana", "Northfield Gas", "57 dollars", "The October bill", "NG-1041"], sid("b"));
    expect(turns.flatMap(spokenIn).at(-1)).toBe(script.reply_handled);
    expect(await calls(circle)).toEqual([{ simulated: false, verdict: "no_match", cents: 5700, organization: "Northfield Gas", caller_number: CALLER, known_payee: true }]);
    const [alert] = await serviceRows(db, circle.circleId, "select spoken_text from narrations where claim_check_id in (select claim_check_id from office_calls) limit 1");
    expect(String(alert?.spoken_text)).toMatch(/\$57\.00 was already paid to Northfield Gas on Oct 2/);
  });

  it("tells the caller a real open bill is handled, and records the match", async () => {
    const circle = await visitorWithCircle(db);
    const turns = await call(circle, ["Sam", "Ridgeway Stairlifts", "900 dollars", "The stairlift", "RS-77"], sid("c"));
    expect(turns.flatMap(spokenIn).at(-1)).toBe(script.reply_handled);
    expect(await calls(circle)).toEqual([{ simulated: false, verdict: "match", cents: 90000, organization: "Ridgeway Stairlifts", caller_number: CALLER, known_payee: true }]);
  });

  it("records a call that was hung up after the organization was named, when Twilio reports the end", async () => {
    const circle = await visitorWithCircle(db);
    await call(circle, ["Mike", "Harbor Gas Services", "300 dollars"], sid("d"));
    const twilio = twilioCaller(running?.baseUrl ?? "", TEST_AUTH_TOKEN);
    await twilio.post("/voice/status", { CallSid: sid("d"), From: CALLER, To: NUMBER, CallStatus: "completed" });
    expect(await calls(circle)).toEqual([expect.objectContaining({ simulated: false, verdict: "no_match", cents: 30000 })]);
  });

  it("writes only to the circle the dialled number belongs to", async () => {
    const mine = await visitorWithCircle(db);
    const other = await visitorWithCircle(db);
    await call(mine, ["Mike", "Harbor Gas Services", "300 dollars", "Gas", "1"], sid("e"), other);
    expect(await calls(mine)).toHaveLength(1);
    expect(await calls(other)).toEqual([]);
    // A call to the other circle's number is answered for that circle, whatever number the caller dials from.
    const started = await twilioCaller(running?.baseUrl ?? "", TEST_AUTH_TOKEN).post("/voice/incoming", { CallSid: sid("f"), From: NUMBER, To: OTHER_NUMBER });
    expect(spokenIn(started.body)).toEqual([script.disclosure, script.ask_caller]);
  });

  it("answers an unknown number without touching any circle", async () => {
    const circle = await visitorWithCircle(db);
    running = await startService({ numbers: new Map([[NUMBER, { circleId: circle.circleId, locale: "en" }]]), store: storeOn() });
    const reply = await twilioCaller(running.baseUrl, TEST_AUTH_TOKEN).post("/voice/incoming", { CallSid: sid("9"), From: CALLER, To: "+15555550777" });
    expect(spokenIn(reply.body)).toEqual([script.reply_no_record]);
    expect(await calls(circle)).toEqual([]);
  });
});

describe("the office line, when Twilio delivers a webhook more than once", () => {
  const FINAL = "55821";
  const SCAM_BEFORE_LAST = ["Mike", "Harbor Gas Services", "I need 300 dollars today", "Your gas will be cut off today. Tell no one."];
  const alertsFor = (circle: VisitorCircle) => serviceRows(db, circle.circleId, "select distinct claim_check_id from narrations where claim_check_id in (select claim_check_id from office_calls)");
  const recorded = (circle: VisitorCircle) => serviceRows(db, circle.circleId, "select id from office_calls");

  /** Plays the call up to the caller's last answer and returns what is needed to deliver it as often as wanted. */
  async function upToLastTurn(circle: VisitorCircle, callSid: string) {
    const turns = await call(circle, SCAM_BEFORE_LAST, callSid);
    const baseUrl = running?.baseUrl ?? "";
    const twilio = twilioCaller(baseUrl, TEST_AUTH_TOKEN);
    const path = nextTurnPath(turns.at(-1) ?? "", baseUrl) ?? "";
    const fields = { CallSid: callSid, From: CALLER, To: NUMBER, CallStatus: "in-progress", SpeechResult: FINAL };
    return { twilio, path, fields, status: { CallSid: callSid, From: CALLER, To: NUMBER, CallStatus: "completed" } };
  }

  it("records the call once and queues one family alert when the final turn arrives twice at the same moment", async () => {
    const circle = await visitorWithCircle(db);
    const { twilio, path, fields } = await upToLastTurn(circle, sid("1"));
    const [one, two] = await Promise.all([twilio.post(path, fields), twilio.post(path, fields)]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(two.body).toBe(one.body);
    expect(await recorded(circle)).toHaveLength(1);
    expect(await alertsFor(circle)).toHaveLength(1);
    expect(await serviceRows(db, circle.circleId, "select id from audit_log where action = 'office_call.recorded'")).toHaveLength(1);
  });

  it("answers a retried final turn with the same TwiML and records nothing more", async () => {
    const circle = await visitorWithCircle(db);
    const { twilio, path, fields } = await upToLastTurn(circle, sid("2"));
    const first = await twilio.post(path, fields);
    const retried = await twilio.post(path, fields);
    expect(retried).toEqual(first);
    expect(spokenIn(first.body).at(-1)).toBe(script.reply_no_record);
    expect(await recorded(circle)).toHaveLength(1);
  });

  it("does not record again when the status report follows the final turn, or arrives with it", async () => {
    const circle = await visitorWithCircle(db);
    const { twilio, path, fields, status } = await upToLastTurn(circle, sid("3"));
    await twilio.post(path, fields);
    await twilio.post("/voice/status", status);
    expect(await recorded(circle)).toHaveLength(1);

    const second = await visitorWithCircle(db);
    const concurrent = await upToLastTurn(second, sid("4"));
    await Promise.all([concurrent.twilio.post(concurrent.path, concurrent.fields), concurrent.twilio.post("/voice/status", concurrent.status)]);
    expect(await recorded(second)).toHaveLength(1);
    expect(await alertsFor(second)).toHaveLength(1);
  });

  it("records a call once even when another instance, with no memory of it, is handed the same delivery", async () => {
    const circle = await visitorWithCircle(db);
    const { twilio, path, fields } = await upToLastTurn(circle, sid("5"));
    await twilio.post(path, fields);
    await running?.close();
    // A fresh process: its call book is empty, so only the database stands between this delivery and a second record.
    running = await startService({ numbers: new Map([[NUMBER, { circleId: circle.circleId, locale: "en" as const }]]), store: storeOn() });
    const reply = await twilioCaller(running.baseUrl, TEST_AUTH_TOKEN).post(path, fields);
    expect(reply.status).toBe(200);
    expect(await recorded(circle)).toHaveLength(1);
    expect(await alertsFor(circle)).toHaveLength(1);
  });
});
