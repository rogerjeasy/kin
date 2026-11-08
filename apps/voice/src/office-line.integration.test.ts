import { asPerson, asService, readLineRecord, readOfficeCalls, recordLineCall } from "@kin/db";
import { serviceRows, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { OFFICE_WORDS } from "@kin/telephony";
import { afterEach, describe, expect, it } from "vitest";

import type { LineStore } from "./office-line-service.ts";
import { TEST_AUTH_TOKEN, startService, type RunningService } from "./testing/start-service.ts";
import { playCall, spokenIn, twilioCaller } from "./testing/twilio-caller.ts";

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
