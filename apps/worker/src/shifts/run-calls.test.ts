import { SHIFT_CALL_TOPIC, asService, recordCallStatus, recordFamilyWordByCall } from "@kin/db";
import { PARENT_PHONE, serviceRows, setQuietHours, testDatabases, visitorWithCircle, waitingForWord } from "@kin/db/testing";
import { OutboundCallError, fakeOutboundCaller, openShiftCallToken, type FakeOutboundCaller, type OutboundCaller } from "@kin/telephony";
import { afterEach, describe, expect, it } from "vitest";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

import { WATCH_SECONDS, type CallDeps } from "./place-call.ts";
import { runCallBatch } from "./run-calls.ts";
import { adminQuery, ageCallAttempts, releaseMessages } from "./shift-test-support.ts";
import { STALE_CALL_MINUTES, sweepStaleCall } from "./sweep-stale-call.ts";

const db = testDatabases();
const KEY = "call-token-key-0123456789abcdef0123456789";
const PUBLIC_URL = "https://voice.example.com";
const lines: Record<string, unknown>[] = [];
const log: InboxLog = (line) => lines.push(line);
const admin = (text: string, params: readonly unknown[] = []) => adminQuery(db, text, params);
let pauses = 0;

const depsFor = (caller: OutboundCaller): CallDeps => ({
  db: db.service,
  caller,
  publicUrl: PUBLIC_URL,
  tokenKey: KEY,
  now: () => new Date(),
  pause: () => {
    pauses += 1;
    return Promise.resolve();
  },
});

/** The batch leases whatever any circle has waiting, so it is drained until it finds nothing. */
async function drain(caller: OutboundCaller): Promise<void> {
  while ((await runCallBatch(depsFor(caller), log)) > 0);
}

const attempts = (circleId: string, shiftId: string) =>
  serviceRows(db, circleId, "select attempt, state, call_sid is not null as has_sid, last_error from shift_calls where shift_id = $1 order by attempt", [shiftId]);
const messages = (circleId: string) =>
  serviceRows(db, circleId, "select sent_at is not null as sent, (available_at - now()) > interval '25 minutes' as far, (available_at - now()) > interval '4 minutes' as later from outbox where topic = $1 and circle_id = $2 order by created_at, id", [SHIFT_CALL_TOPIC, circleId]);
const pending = async (circleId: string) => (await messages(circleId)).filter((message) => message["sent"] === false).length;
const release = (circleId: string) => releaseMessages(db, circleId, SHIFT_CALL_TOPIC);
const sidOf = async (circleId: string, shiftId: string) => String((await serviceRows(db, circleId, "select call_sid from shift_calls where shift_id = $1 order by attempt desc limit 1", [shiftId]))[0]?.["call_sid"]);

afterEach(() => {
  lines.length = 0;
  pauses = 0;
});

describe("the call loop: placing the call", () => {
  it("dials the parent once for a shift that waits for her word, with a sealed token for this circle, shift and attempt, and logs neither number nor token", async () => {
    const caller = fakeOutboundCaller();
    const { circleId, shiftId } = await waitingForWord(db);
    await drain(caller);

    expect(caller.placed).toHaveLength(1);
    const [request] = caller.placed;
    expect(request?.to).toBe(PARENT_PHONE);
    const sealed = new URL(request?.answerUrl ?? "").searchParams.get("s") ?? "";
    expect(new URL(request?.answerUrl ?? "").pathname).toBe("/voice/shift/answer");
    expect(new URL(request?.statusUrl ?? "").pathname).toBe("/voice/shift/status");
    expect(new URL(request?.statusUrl ?? "").origin).toBe(PUBLIC_URL);
    expect(openShiftCallToken(sealed, KEY, Date.now())).toEqual({ circleId, shiftId, attempt: 1, locale: "en", reasked: 0 });
    expect(openShiftCallToken(sealed, `${KEY}x`, Date.now())).toBeNull();

    expect(await attempts(circleId, shiftId)).toEqual([{ attempt: 1, state: "calling", has_sid: true, last_error: null }]);
    expect(await serviceRows(db, circleId, "select count(*)::int as n from audit_log where action = 'shift.call_started' and subject_id = $1", [shiftId])).toEqual([{ n: 1 }]);
    const written = JSON.stringify(lines);
    expect(written).toContain("shift_call.placed");
    expect(written).not.toContain(PARENT_PHONE.slice(1));
    expect(written).not.toContain(sealed);
    expect(written).not.toContain("?s=");
  });

  it("keeps the message as a watch after dialing, never dials the same shift again while the attempt is live, and finishes once the shift has its word", async () => {
    const caller = fakeOutboundCaller();
    const { circleId, shiftId } = await waitingForWord(db);
    await drain(caller);
    expect(await messages(circleId)).toEqual([{ sent: false, far: true, later: true }]);
    expect(WATCH_SECONDS).toBeGreaterThan(STALE_CALL_MINUTES * 60);

    // Handed out again before the watch (a restart, a duplicate): the database says a call is under way.
    await release(circleId);
    await drain(caller);
    expect(caller.placed).toHaveLength(1);
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_call.refused", shiftId, reason: "in_progress" }));
    expect(await messages(circleId)).toEqual([{ sent: false, far: false, later: true }]);

    // The parent said yes on that call: the visit that follows has nothing left to do.
    const callSid = await sidOf(circleId, shiftId);
    await asService(db.service, circleId, (tx) => recordFamilyWordByCall(tx, { circleId, shiftId, callSid, answer: "yes" }));
    await release(circleId);
    await drain(caller);
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_call.refused", shiftId, reason: "not_waiting" }));
    expect(await pending(circleId)).toBe(0);
    expect(caller.placed).toHaveLength(1);
  });

  it("dials once when two messages for the same shift are handed out together", async () => {
    const caller = fakeOutboundCaller();
    const { circleId, shiftId } = await waitingForWord(db);
    await admin("insert into outbox (id, circle_id, topic, payload) values (gen_random_uuid(), $1, $2, $3::jsonb)", [circleId, SHIFT_CALL_TOPIC, JSON.stringify({ shiftId })]);
    await drain(caller);
    expect(caller.placed).toHaveLength(1);
    expect(await attempts(circleId, shiftId)).toHaveLength(1);
  });

  it("holds the call through quiet hours, to the minute they end, and dials after", async () => {
    const caller = fakeOutboundCaller();
    const { circleId, shiftId } = await waitingForWord(db);
    await setQuietHours(db, circleId, "inside");
    await release(circleId);
    await drain(caller);
    expect(caller.placed).toEqual([]);
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_call.refused", shiftId, reason: "quiet_hours" }));
    // Quiet hours around now end in about an hour.
    expect(await serviceRows(db, circleId, "select (available_at - now()) between interval '55 minutes' and interval '65 minutes' as at_the_end from outbox where topic = $1 and circle_id = $2", [SHIFT_CALL_TOPIC, circleId])).toEqual([{ at_the_end: true }]);
    expect(await attempts(circleId, shiftId)).toEqual([]);

    await setQuietHours(db, circleId, "outside");
    await release(circleId);
    await drain(caller);
    expect(caller.placed).toHaveLength(1);
  });

  it("finishes the message of a shift Kin will not call about, and says why", async () => {
    const caller = fakeOutboundCaller();
    const off = await waitingForWord(db);
    await admin("update parent_call_settings set enabled = false where circle_id = $1", [off.circleId]);
    await drain(caller);
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_call.refused", shiftId: off.shiftId, reason: "not_enabled" }));
    expect(await pending(off.circleId)).toBe(0);

    // A demo circle never has a real call placed, whatever its settings say.
    const demo = await waitingForWord(db);
    await admin("update circles set demo = true where id = $1", [demo.circleId]);
    await drain(caller);
    expect(caller.placed).toEqual([]);
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_call.refused", shiftId: demo.shiftId, reason: "demo_circle" }));
    expect(await pending(demo.circleId)).toBe(0);
  });

  it("drops a message it cannot read instead of retrying it for ever", async () => {
    const caller = fakeOutboundCaller();
    const circle = await visitorWithCircle(db);
    await admin(`insert into outbox (id, circle_id, topic, payload) values (gen_random_uuid(), $1, $2, '{"shiftId": 7}'::jsonb)`, [circle.circleId, SHIFT_CALL_TOPIC]);
    await drain(caller);
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_call.unreadable_message" }));
    expect(await pending(circle.circleId)).toBe(0);
  });
});

describe("the call loop: when the dial goes wrong", () => {
  it("records a call Twilio refused for good as failed, finishes the message, and leaves the second attempt to the database", async () => {
    const caller = fakeOutboundCaller();
    caller.failNext(new OutboundCallError("bad_number", { retryable: false, mayHaveBeenPlaced: false, twilioCode: 21211 }));
    const { circleId, shiftId } = await waitingForWord(db);
    await drain(caller);
    expect(caller.placed).toEqual([]);
    expect(await attempts(circleId, shiftId)).toEqual([{ attempt: 1, state: "failed", has_sid: false, last_error: "bad_number" }]);
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_call.refused_by_provider", reason: "bad_number", twilioCode: 21211 }));
    // This message is done; the database queued the second attempt for after its wait.
    expect(await messages(circleId)).toEqual([{ sent: true, far: false, later: false }, { sent: false, far: true, later: true }]);
  });

  it("never dials again after an error that says a call may have been placed, and keeps the attempt queued", async () => {
    const caller = fakeOutboundCaller();
    caller.failNext(new OutboundCallError("network", { retryable: true, mayHaveBeenPlaced: true }));
    const { circleId, shiftId } = await waitingForWord(db);
    await drain(caller);
    expect(caller.placed).toEqual([]);
    expect(await attempts(circleId, shiftId)).toEqual([{ attempt: 1, state: "queued", has_sid: false, last_error: null }]);
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_call.dial_unknown", reason: "network" }));
    expect(await messages(circleId)).toEqual([{ sent: false, far: true, later: true }]);

    await release(circleId);
    await drain(caller);
    expect(caller.placed).toEqual([]);
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_call.refused", shiftId, reason: "in_progress" }));
  });

  it("asks Twilio again after its concurrency limit refused the call, on the same attempt", async () => {
    const caller = fakeOutboundCaller();
    caller.failNext(new OutboundCallError("rate_limited", { retryable: true, mayHaveBeenPlaced: false, twilioCode: 20429 }));
    const { circleId, shiftId } = await waitingForWord(db);
    await drain(caller);
    expect(pauses).toBe(1);
    expect(caller.placed).toHaveLength(1);
    expect(await attempts(circleId, shiftId)).toEqual([{ attempt: 1, state: "calling", has_sid: true, last_error: null }]);
  });

  it("gives up an attempt that Twilio keeps refusing at its limit, as failed, without ringing anyone", async () => {
    let tries = 0;
    const caller: OutboundCaller = {
      placeCall: () => {
        tries += 1;
        return Promise.reject(new OutboundCallError("rate_limited", { retryable: true, mayHaveBeenPlaced: false }));
      },
    };
    const { circleId, shiftId } = await waitingForWord(db);
    await drain(caller);
    expect(tries).toBe(3);
    expect(pauses).toBe(2);
    expect(await attempts(circleId, shiftId)).toEqual([{ attempt: 1, state: "failed", has_sid: false, last_error: "rate_limited" }]);
  });

  it("treats a failure Kin does not recognise as a call that may have been placed", async () => {
    const caller: OutboundCaller = { placeCall: () => Promise.reject(new TypeError("boom")) };
    const { circleId, shiftId } = await waitingForWord(db);
    await drain(caller);
    expect(await attempts(circleId, shiftId)).toEqual([{ attempt: 1, state: "queued", has_sid: false, last_error: null }]);
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_call.dial_unknown", reason: "TypeError" }));
  });
});

describe("the call loop: a crash between the dial and recording it, and a lost report", () => {
  async function faultOnCallUpdate(circleId: string): Promise<() => Promise<void>> {
    await admin(`create or replace function public.test_fail_call() returns trigger language plpgsql as $$ begin raise exception 'injected fault'; end $$`);
    await admin(`create trigger test_fail_call before update on public.shift_calls for each row when (new.circle_id = '${circleId}') execute function public.test_fail_call()`);
    return async () => {
      await admin("drop trigger test_fail_call on public.shift_calls");
      await admin("drop function public.test_fail_call()");
    };
  }

  it("never dials twice when the call went out but recording it failed, and gives up on the lost attempt so the second can be placed", async () => {
    const caller = fakeOutboundCaller();
    const { circleId, shiftId } = await waitingForWord(db);
    const lift = await faultOnCallUpdate(circleId);
    try {
      await drain(caller);
    } finally {
      await lift();
    }
    // The fake took the call; the record of its ID failed. The attempt is still queued.
    expect(caller.placed).toHaveLength(1);
    expect(await attempts(circleId, shiftId)).toEqual([{ attempt: 1, state: "queued", has_sid: false, last_error: null }]);
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_call.record_failed", error: expect.any(String) }));
    expect(JSON.stringify(lines)).not.toContain("injected fault");

    // The message comes back, with the fault gone: the database still says a call is under way, so nothing is dialed.
    await release(circleId);
    await drain(caller);
    expect(caller.placed).toHaveLength(1);
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_call.refused", shiftId, reason: "in_progress" }));

    // No report ever comes. Half an hour on, the visit gives up on the attempt, and the database queues its second.
    await ageCallAttempts(db, circleId, STALE_CALL_MINUTES + 1);
    await release(circleId);
    await drain(caller);
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_call.gave_up_on_stale_attempt", shiftId }));
    expect(await attempts(circleId, shiftId)).toEqual([{ attempt: 1, state: "failed", has_sid: false, last_error: "no_report" }]);
    expect(caller.placed).toHaveLength(1);

    // After its wait, the second attempt is dialed, once, however many messages say so.
    await ageCallAttempts(db, circleId, STALE_CALL_MINUTES + 1);
    await release(circleId);
    await drain(caller);
    expect(caller.placed).toHaveLength(2);
    expect(await attempts(circleId, shiftId)).toEqual([
      { attempt: 1, state: "failed", has_sid: false, last_error: "no_report" },
      { attempt: 2, state: "calling", has_sid: true, last_error: null },
    ]);
    const token = openShiftCallToken(new URL(caller.placed[1]?.answerUrl ?? "").searchParams.get("s") ?? "", KEY, Date.now());
    expect(token).toMatchObject({ shiftId, attempt: 2 });
  });

  it("gives up on a dialed attempt whose status callback never came, only after it is stale", async () => {
    const caller: FakeOutboundCaller = fakeOutboundCaller();
    const { circleId, shiftId } = await waitingForWord(db);
    await drain(caller);
    expect(await sweepStaleCall(db.service, circleId, shiftId)).toBe(false);
    expect(await attempts(circleId, shiftId)).toEqual([{ attempt: 1, state: "calling", has_sid: true, last_error: null }]);

    await ageCallAttempts(db, circleId, STALE_CALL_MINUTES + 1);
    expect(await sweepStaleCall(db.service, circleId, shiftId)).toBe(true);
    expect(await attempts(circleId, shiftId)).toEqual([{ attempt: 1, state: "failed", has_sid: true, last_error: "no_report" }]);
    // The database queued the second attempt; sweeping again finds nothing.
    expect(await pending(circleId)).toBe(2);
    expect(await sweepStaleCall(db.service, circleId, shiftId)).toBe(false);
  });

  it("does not sweep a call that already ended, and a late report for one it swept changes nothing", async () => {
    const caller = fakeOutboundCaller();
    const { circleId, shiftId } = await waitingForWord(db);
    await drain(caller);
    const callSid = await sidOf(circleId, shiftId);
    await asService(db.service, circleId, (tx) => recordCallStatus(tx, { circleId, shiftId, callSid, status: "no_answer" }));
    await ageCallAttempts(db, circleId, STALE_CALL_MINUTES + 1);
    expect(await sweepStaleCall(db.service, circleId, shiftId)).toBe(false);
    expect(await attempts(circleId, shiftId)).toEqual([{ attempt: 1, state: "no_answer", has_sid: true, last_error: null }]);
  });
});
