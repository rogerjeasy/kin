import { SHIFT_CALL_TOPIC, SHIFT_SETTLE_TOPIC } from "@kin/db";
import { serviceRows, startedCall, testDatabases, waitingForWord, type RealCircle } from "@kin/db/testing";
import { type ShiftCallToken } from "@kin/telephony";
import { afterEach, describe, expect, it } from "vitest";

import { TEST_AUTH_TOKEN, TEST_STATE_KEY, startService, type RunningService } from "../testing/start-service.ts";
import { outboundFields, playShiftCall, shiftCallPath, type Heard } from "../testing/shift-caller.ts";
import { spokenIn, twilioCaller } from "../testing/twilio-caller.ts";
import { shiftCallStoreOn } from "./shift-call-store.ts";

/**
 * Shift calls through the real HTTP handlers, signed as Twilio signs them, against a real PostgreSQL with the
 * migrations applied and the real `kin_service` role: what the family finds afterwards is what the database holds.
 */
const db = testDatabases();
const SORRY = ["Sorry, I cannot take this call right now. Goodbye."];

let running: RunningService | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function serve() {
  running = await startService({
    numbers: new Map(),
    store: { read: () => Promise.resolve(null), record: () => Promise.reject(new Error("The office line is not used")) },
    shiftCalls: shiftCallStoreOn(db.service),
  });
  return { twilio: twilioCaller(running.baseUrl, TEST_AUTH_TOKEN), baseUrl: running.baseUrl, now: running.now };
}

type Started = RealCircle & { readonly shiftId: string; readonly callSid: string; readonly token: ShiftCallToken };

/** A real circle whose shift waits for the parent's word, with Kin's call started and, unless told not to, placed. */
async function calling(options: { place?: boolean } = {}): Promise<Started> {
  const circle = await waitingForWord(db);
  const { call, callSid } = await startedCall(db, circle, circle.shiftId, options);
  return { ...circle, callSid: callSid ?? `CA${call.callId.replaceAll("-", "")}`, token: { circleId: circle.circleId, shiftId: circle.shiftId, attempt: call.attempt, locale: "en", reasked: 0 } };
}

async function play(call: Started, hears: readonly Heard[], answeredBy?: string) {
  const { twilio, baseUrl, now } = await serve();
  return playShiftCall(twilio, baseUrl, { sid: call.callSid, firstPath: shiftCallPath("answer", call.token, TEST_STATE_KEY, now.at), hears, ...(answeredBy === undefined ? {} : { answeredBy }) });
}

const shiftRow = async (circle: Started) =>
  (await serviceRows(db, circle.circleId, "select state::text as state, family_confirmed_by, family_confirmation::text as kind, family_evidence_ref as evidence from shifts where id = $1", [circle.shiftId]))[0];
const callRows = (circle: Started) => serviceRows(db, circle.circleId, "select attempt, state, call_sid is not null as has_sid, last_error from shift_calls where shift_id = $1 order by attempt", [circle.shiftId]);
const queuedCount = async (circle: Started, topic: string) =>
  Number((await serviceRows(db, circle.circleId, "select count(*)::int as n from outbox where topic = $1 and payload ->> 'shiftId' = $2", [topic, circle.shiftId]))[0]?.["n"]);
const audit = async (circle: Started, action: string) =>
  serviceRows(db, circle.circleId, "select actor::text as actor, origin from audit_log where action = $1 and subject_id = $2", [action, circle.shiftId]);
const post = (path: string, fields: Record<string, string>, sign = true) => twilioCaller(running?.baseUrl ?? "", TEST_AUTH_TOKEN).post(path, fields, { sign });

describe("the parent's word, by phone, in a real circle", () => {
  it("records her yes by keypad as the parent's word, confirms the shift, queues its settling once, and audits it as the service by phone", async () => {
    const call = await calling();
    const turns = await play(call, [{ digits: "1" }]);
    expect(spokenIn(turns[1] ?? "")).toEqual(["Thank you. I have told Amara and the family."]);
    expect(await shiftRow(call)).toEqual({ state: "confirmed", family_confirmed_by: call.members.rose, kind: "parent", evidence: call.callSid });
    expect(await callRows(call)).toEqual([{ attempt: 1, state: "confirmed", has_sid: true, last_error: null }]);
    expect(await queuedCount(call, SHIFT_SETTLE_TOPIC)).toBe(1);
    expect(await audit(call, "shift.word_by_call")).toEqual([{ actor: "service", origin: "phone" }]);
  });

  it("records her yes by speech", async () => {
    const call = await calling();
    await play(call, [{ speech: "Yes, Amara was here this morning" }]);
    expect(await shiftRow(call)).toMatchObject({ state: "confirmed", kind: "parent" });
  });

  it("records her no as a declined call and confirms nothing, queuing no settling", async () => {
    const call = await calling();
    const turns = await play(call, [{ digits: "2" }]);
    expect(spokenIn(turns[1] ?? "")[0]).toBe("Thank you for telling me.");
    expect(await shiftRow(call)).toEqual({ state: "checked_out", family_confirmed_by: null, kind: null, evidence: null });
    expect(await callRows(call)).toEqual([{ attempt: 1, state: "declined", has_sid: true, last_error: null }]);
    expect(await queuedCount(call, SHIFT_SETTLE_TOPIC)).toBe(0);
  });

  it("records nothing about the shift for an unclear answer, asks again, and records her yes after", async () => {
    const call = await calling();
    await play(call, [{ speech: "hmm, maybe" }, { speech: "yes" }]);
    expect(await shiftRow(call)).toMatchObject({ state: "confirmed", kind: "parent" });
    expect(await queuedCount(call, SHIFT_SETTLE_TOPIC)).toBe(1);
  });

  it("never records a word when she stays silent or unclear twice, and the status report then fails the attempt so a second can follow", async () => {
    for (const hears of [["silence", "silence"], [{ speech: "what?" }, { speech: "I cannot say" }]] as const) {
      const call = await calling();
      await play(call, hears);
      expect(await shiftRow(call)).toEqual({ state: "checked_out", family_confirmed_by: null, kind: null, evidence: null });
      expect(await callRows(call)).toEqual([{ attempt: 1, state: "answered", has_sid: true, last_error: null }]);
      expect(await queuedCount(call, SHIFT_SETTLE_TOPIC)).toBe(0);

      const before = await queuedCount(call, SHIFT_CALL_TOPIC);
      const status = shiftCallPath("status", call.token, TEST_STATE_KEY, running?.now.at ?? 0);
      expect((await post(status, outboundFields(call.callSid, { CallStatus: "completed" }))).status).toBe(200);
      expect(await callRows(call)).toEqual([{ attempt: 1, state: "failed", has_sid: true, last_error: "no_word" }]);
      // The database queued the second attempt, once, however often the report comes.
      expect(await queuedCount(call, SHIFT_CALL_TOPIC)).toBe(before + 1);
      await post(status, outboundFields(call.callSid, { CallStatus: "completed" }));
      expect(await queuedCount(call, SHIFT_CALL_TOPIC)).toBe(before + 1);
      await running?.close();
    }
  });

  it("records a voicemail as an unanswered call, saying nothing", async () => {
    const call = await calling();
    const turns = await play(call, [], "machine_end_beep");
    expect(turns).toEqual(['<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>']);
    expect(await callRows(call)).toEqual([{ attempt: 1, state: "no_answer", has_sid: true, last_error: "machine" }]);
    expect(await shiftRow(call)).toMatchObject({ state: "checked_out", family_confirmed_by: null });
  });

  it("takes the first webhook for an attempt the worker has not yet recorded the ID of, and the word then lands on it", async () => {
    const call = await calling({ place: false });
    expect(await callRows(call)).toEqual([{ attempt: 1, state: "queued", has_sid: false, last_error: null }]);
    await play(call, [{ digits: "1" }]);
    expect(await callRows(call)).toEqual([{ attempt: 1, state: "confirmed", has_sid: true, last_error: null }]);
    expect(await shiftRow(call)).toMatchObject({ state: "confirmed", evidence: call.callSid });
  });

  it("records a status report that beats the worker's record, as unanswered", async () => {
    const call = await calling({ place: false });
    const { twilio, now } = await serve();
    await twilio.post(shiftCallPath("status", call.token, TEST_STATE_KEY, now.at), outboundFields(call.callSid, { CallStatus: "no-answer" }));
    expect(await callRows(call)).toEqual([{ attempt: 1, state: "no_answer", has_sid: true, last_error: null }]);
  });

  it("records her word once when the same request arrives again and again, or at the same moment", async () => {
    const call = await calling();
    const { twilio, baseUrl, now } = await serve();
    const first = await twilio.post(shiftCallPath("answer", call.token, TEST_STATE_KEY, now.at), outboundFields(call.callSid));
    const path = first.body.match(/action="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&").replace(baseUrl, "") ?? "";
    const fields = outboundFields(call.callSid, { Digits: "1" });
    const replies = await Promise.all([twilio.post(path, fields), twilio.post(path, fields), twilio.post(path, fields)]);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200, 200]);
    expect(new Set(replies.map((reply) => reply.body)).size).toBe(1);
    await twilio.post(path, fields);
    expect(await queuedCount(call, SHIFT_SETTLE_TOPIC)).toBe(1);
    expect(await audit(call, "shift.word_by_call")).toHaveLength(1);
    expect((await shiftRow(call))?.state).toBe("confirmed");
  });
});

describe("what the database and the service refuse", () => {
  it("refuses a CallSid that belongs to another shift's call, in this circle or another, and records nothing on either", async () => {
    const [mine, theirs] = [await calling(), await calling()];
    const { twilio, now } = await serve();
    const path = shiftCallPath("answer", mine.token, TEST_STATE_KEY, now.at);
    // The other circle's call ID, with my token: the call is not mine, and it is not asked a question.
    const reply = await twilio.post(path, outboundFields(theirs.callSid, { Digits: "1" }));
    expect(spokenIn(reply.body)).toEqual(SORRY);
    const status = await twilio.post(shiftCallPath("status", mine.token, TEST_STATE_KEY, now.at), outboundFields(theirs.callSid, { CallStatus: "completed" }));
    expect(status.status).toBe(403);
    for (const circle of [mine, theirs]) {
      expect(await shiftRow(circle)).toMatchObject({ state: "checked_out", family_confirmed_by: null });
      expect(await callRows(circle)).toEqual([{ attempt: 1, state: "calling", has_sid: true, last_error: null }]);
      expect(await queuedCount(circle, SHIFT_SETTLE_TOPIC)).toBe(0);
    }
  });

  it("refuses an attempt number that is not the call's, and a second shift of the same circle", async () => {
    const call = await calling();
    const { twilio, now } = await serve();
    const wrongAttempt = shiftCallPath("answer", { ...call.token, attempt: 2 }, TEST_STATE_KEY, now.at);
    expect(spokenIn((await twilio.post(wrongAttempt, outboundFields(call.callSid, { Digits: "1" }))).body)).toEqual(SORRY);
    const otherShift = shiftCallPath("answer", { ...call.token, shiftId: "7c1d9e2a-3b4c-4d5e-8f6a-1b2c3d4e5f60" }, TEST_STATE_KEY, now.at);
    expect(spokenIn((await twilio.post(otherShift, outboundFields(call.callSid, { Digits: "1" }))).body)).toEqual(SORRY);
    expect(await shiftRow(call)).toMatchObject({ state: "checked_out", family_confirmed_by: null });
  });

  it("answers a wrong signature with a bare 403, and a forged or expired token with the sorry, and records nothing", async () => {
    const call = await calling();
    const { twilio, now } = await serve();
    const path = shiftCallPath("answer", call.token, TEST_STATE_KEY, now.at);
    expect(await twilio.post(path, outboundFields(call.callSid, { Digits: "1" }), { sign: false })).toEqual({ status: 403, body: "Forbidden" });
    expect(await twilio.post(path, outboundFields(call.callSid, { Digits: "1" }), { authToken: "another-auth-token-0123456789" })).toEqual({ status: 403, body: "Forbidden" });
    const forged = shiftCallPath("answer", call.token, `${TEST_STATE_KEY}-not-ours`, now.at);
    expect(spokenIn((await twilio.post(forged, outboundFields(call.callSid, { Digits: "1" }))).body)).toEqual(SORRY);
    now.at += 21 * 60 * 1000;
    expect(spokenIn((await twilio.post(path, outboundFields(call.callSid, { Digits: "1" }))).body)).toEqual(SORRY);
    expect(await shiftRow(call)).toMatchObject({ state: "checked_out", family_confirmed_by: null });
    expect(await callRows(call)).toEqual([{ attempt: 1, state: "calling", has_sid: true, last_error: null }]);
  });

  it("does not tell her her yes was kept when the database refuses it: the call was switched off while she listened", async () => {
    const call = await calling();
    const { twilio, now } = await serve();
    await twilio.post(shiftCallPath("answer", call.token, TEST_STATE_KEY, now.at), outboundFields(call.callSid));
    await db.admin.$client.query("update parent_call_settings set enabled = false where circle_id = $1", [call.circleId]);
    const reply = await twilio.post(shiftCallPath("answer", call.token, TEST_STATE_KEY, now.at), outboundFields(call.callSid, { Digits: "1" }));
    expect(spokenIn(reply.body)).toEqual(SORRY);
    expect(await shiftRow(call)).toMatchObject({ state: "checked_out", family_confirmed_by: null });
    expect(await queuedCount(call, SHIFT_SETTLE_TOPIC)).toBe(0);
  });

  it("refuses the answer of a call that is already over", async () => {
    const call = await calling();
    const { twilio, now } = await serve();
    await twilio.post(shiftCallPath("status", call.token, TEST_STATE_KEY, now.at), outboundFields(call.callSid, { CallStatus: "no-answer" }));
    const late = await twilio.post(shiftCallPath("answer", call.token, TEST_STATE_KEY, now.at), outboundFields(call.callSid, { Digits: "1" }));
    expect(spokenIn(late.body)).toEqual(SORRY);
    expect(await shiftRow(call)).toMatchObject({ state: "checked_out", family_confirmed_by: null });
  });
});
