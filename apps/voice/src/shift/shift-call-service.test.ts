import { randomUUID } from "node:crypto";

import { SHIFT_CALL_TOKEN_TTL_MS, type ShiftCallToken } from "@kin/telephony";
import { afterEach, describe, expect, it } from "vitest";

import { memoryShiftCallStore, type MemoryShiftCall, type MemoryShiftCallStore } from "./memory-shift-call-store.ts";
import { TEST_AUTH_TOKEN, TEST_STATE_KEY, startService, type RunningService } from "../testing/start-service.ts";
import { KIN_NUMBER, PARENT_NUMBER, outboundFields, playShiftCall, shiftCallPath, type Heard } from "../testing/shift-caller.ts";
import { spokenIn, twilioCaller } from "../testing/twilio-caller.ts";

const sid = (digit: string) => `CA${digit.repeat(32)}`;
const CIRCLE = randomUUID();
const SHIFT = randomUUID();
const OTHER_SHIFT = randomUUID();
const OTHER_CIRCLE = randomUUID();
const attempt = (change: Partial<MemoryShiftCall> = {}): MemoryShiftCall => ({
  circleId: CIRCLE,
  shiftId: SHIFT,
  attempt: 1,
  callSid: sid("a"),
  state: "calling",
  caregiverName: "Amara",
  dayPart: "morning",
  contactName: "Elena",
  ...change,
});
const token = (change: Partial<ShiftCallToken> = {}): ShiftCallToken => ({ circleId: CIRCLE, shiftId: SHIFT, attempt: 1, locale: "en", reasked: 0, ...change });

let running: RunningService | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function serve(attempts: readonly MemoryShiftCall[], withStore = true): Promise<{ store: MemoryShiftCallStore; twilio: ReturnType<typeof twilioCaller>; baseUrl: string; now: { at: number } }> {
  const store = memoryShiftCallStore(attempts);
  running = await startService({ numbers: new Map(), store: { read: () => Promise.resolve(null), record: () => Promise.reject(new Error("The office line is not used")) }, ...(withStore ? { shiftCalls: store } : {}) });
  return { store, twilio: twilioCaller(running.baseUrl, TEST_AUTH_TOKEN), baseUrl: running.baseUrl, now: running.now };
}

const play = async (attempts: readonly MemoryShiftCall[], hears: readonly Heard[], answeredBy?: string) => {
  const served = await serve(attempts);
  const turns = await playShiftCall(served.twilio, served.baseUrl, {
    sid: sid("a"),
    firstPath: shiftCallPath("answer", token(), TEST_STATE_KEY, served.now.at),
    hears,
    ...(answeredBy === undefined ? {} : { answeredBy }),
  });
  return { ...served, turns, said: turns.map(spokenIn) };
};

describe("the parent's answers on the call", () => {
  it("asks who Kin is and the question, and records only that she picked up", async () => {
    const { turns, said, store } = await play([attempt()], []);
    expect(turns).toHaveLength(1);
    expect(said[0]).toEqual([
      "This is Kin, an automated assistant for your family.",
      "If you did not expect this call, you can hang up.",
      "Amara is finishing the visit.",
      "Was Amara with you this morning? Say yes, or press 1. Say no, or press 2.",
    ]);
    expect(store.writes).toEqual([{ kind: "answered", callSid: sid("a") }]);
  });

  it("records her yes by keypad once, as her word, with the shift's settling to follow", async () => {
    const { said, store } = await play([attempt()], [{ digits: "1" }]);
    expect(said[1]).toEqual(["Thank you. I have told Amara and the family."]);
    expect(store.writes).toEqual([{ kind: "answered", callSid: sid("a") }, { kind: "word", callSid: sid("a"), answer: "yes", settleQueued: true }]);
  });

  it("records her yes by speech", async () => {
    const { store } = await play([attempt()], [{ speech: "Yes, she was here" }]);
    expect(store.writes.at(-1)).toMatchObject({ kind: "word", answer: "yes" });
  });

  it("records her no, queues no settling, and tells her it is noted", async () => {
    const { said, store } = await play([attempt()], [{ digits: "2" }]);
    expect(said[1]?.[0]).toBe("Thank you for telling me.");
    expect(store.writes.at(-1)).toEqual({ kind: "word", callSid: sid("a"), answer: "no", settleQueued: false });
  });

  it("asks again after an unclear answer, records nothing in between, and records her yes when it comes", async () => {
    const { said, store } = await play([attempt()], [{ speech: "hmm, maybe" }, { speech: "yes" }]);
    expect(said[1]?.[0]).toBe("Sorry, I did not catch that.");
    expect(store.writes).toEqual([{ kind: "answered", callSid: sid("a") }, { kind: "word", callSid: sid("a"), answer: "yes", settleQueued: true }]);
  });

  it("gives up after silence twice and records no word at all", async () => {
    const { said, store } = await play([attempt()], ["silence", "silence"]);
    expect(said).toHaveLength(3);
    expect(said[2]?.[0]).toBe("I did not hear a clear answer.");
    expect(store.writes).toEqual([{ kind: "answered", callSid: sid("a") }]);
  });

  it("gives up after an unclear answer twice, never taking a guess for a yes", async () => {
    const { store } = await play([attempt()], [{ speech: "what?" }, { speech: "I do not know" }]);
    expect(store.writes.filter((write) => write.kind === "word")).toEqual([]);
  });

  it("says nothing to a voicemail and records the call as unanswered", async () => {
    const { turns, store } = await play([attempt()], [], "machine_start");
    expect(turns).toEqual(['<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>']);
    expect(store.writes).toEqual([{ kind: "ended", callSid: sid("a"), status: "no_answer", error: "machine" }]);
  });

  it("speaks the parent's language, from the token", async () => {
    const served = await serve([attempt()]);
    const first = await served.twilio.post(shiftCallPath("answer", token({ locale: "fr" }), TEST_STATE_KEY, served.now.at), outboundFields(sid("a")));
    expect(spokenIn(first.body)[0]).toContain("Kin");
    expect(first.body).toContain('language="fr-FR"');
  });

  it("takes names and the part of the day from the record, never from the request", async () => {
    const served = await serve([attempt({ caregiverName: "Brigitte", dayPart: "evening", contactName: null })]);
    const first = await served.twilio.post(shiftCallPath("answer", token(), TEST_STATE_KEY, served.now.at), outboundFields(sid("a"), { CallerName: "Mallory", Called: "Mallory" }));
    expect(spokenIn(first.body).join(" ")).toContain("Was Brigitte with you this evening?");
    expect(first.body).not.toContain("Mallory");
  });
});

describe("what the service refuses", () => {
  it("answers a request with a wrong or missing signature with a bare 403 and touches nothing", async () => {
    const { store, twilio, baseUrl, now } = await serve([attempt()]);
    const path = shiftCallPath("answer", token(), TEST_STATE_KEY, now.at);
    for (const route of ["answer", "status"] as const) {
      const target = shiftCallPath(route, token(), TEST_STATE_KEY, now.at);
      expect(await twilio.post(target, outboundFields(sid("a"), { Digits: "1" }), { sign: false })).toEqual({ status: 403, body: "Forbidden" });
      expect(await twilio.post(target, outboundFields(sid("a"), { Digits: "1" }), { authToken: "another-auth-token-0123456789" })).toEqual({ status: 403, body: "Forbidden" });
    }
    // A signature made for another address (another token) does not carry over.
    const fields = outboundFields(sid("a"), { Digits: "1" });
    const forged = await fetch(baseUrl + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "AAAA" }, body: new URLSearchParams(fields).toString() });
    expect(forged.status).toBe(403);
    expect(store.writes).toEqual([]);
  });

  it("answers a forged or expired token with the fixed sorry and records nothing, and an empty answer on the status route", async () => {
    const { store, twilio, now } = await serve([attempt()]);
    const forged = shiftCallPath("answer", token(), `${TEST_STATE_KEY}-not-ours`, now.at);
    const sorry = await twilio.post(forged, outboundFields(sid("a"), { Digits: "1" }));
    expect(sorry.status).toBe(200);
    expect(spokenIn(sorry.body)).toEqual(["Sorry, I cannot take this call right now. Goodbye."]);
    expect(sorry.body).not.toContain("Amara");
    const old = shiftCallPath("answer", token(), TEST_STATE_KEY, now.at - SHIFT_CALL_TOKEN_TTL_MS - 1);
    expect(spokenIn((await twilio.post(old, outboundFields(sid("a"), { Digits: "1" }))).body)).toEqual(["Sorry, I cannot take this call right now. Goodbye."]);
    const status = await twilio.post(shiftCallPath("status", token(), `${TEST_STATE_KEY}-not-ours`, now.at), outboundFields(sid("a"), { CallStatus: "completed" }));
    expect(status).toEqual({ status: 200, body: '<?xml version="1.0" encoding="UTF-8"?><Response/>' });
    // No token at all.
    expect(spokenIn((await twilio.post("/voice/shift/answer", outboundFields(sid("a")))).body)).toEqual(["Sorry, I cannot take this call right now. Goodbye."]);
    expect(store.writes).toEqual([]);
  });

  it("refuses a CallSid that belongs to another shift, another attempt, or another circle", async () => {
    const attempts = [
      attempt(),
      attempt({ shiftId: OTHER_SHIFT, callSid: sid("b") }),
      attempt({ circleId: OTHER_CIRCLE, callSid: sid("c") }),
      attempt({ attempt: 2, callSid: sid("d"), state: "calling" }),
    ];
    const { store, twilio, now } = await serve(attempts);
    const path = shiftCallPath("answer", token(), TEST_STATE_KEY, now.at);
    for (const foreign of [sid("b"), sid("c"), sid("d"), sid("e")]) {
      const reply = await twilio.post(path, outboundFields(foreign, { Digits: "1" }));
      expect(spokenIn(reply.body), foreign).toEqual(["Sorry, I cannot take this call right now. Goodbye."]);
      const status = await twilio.post(shiftCallPath("status", token(), TEST_STATE_KEY, now.at), outboundFields(foreign, { CallStatus: "completed" }));
      expect(status.status, foreign).toBe(403);
    }
    expect(store.writes).toEqual([]);
    expect(store.attempt(CIRCLE, SHIFT, 1)?.state).toBe("calling");
  });

  it("refuses the answer of a call that is already over, without reading it a question", async () => {
    for (const state of ["no_answer", "failed"] as const) {
      const { store, twilio, now } = await serve([attempt({ state })]);
      const reply = await twilio.post(shiftCallPath("answer", token(), TEST_STATE_KEY, now.at), outboundFields(sid("a")));
      expect(spokenIn(reply.body)).toEqual(["Sorry, I cannot take this call right now. Goodbye."]);
      expect(store.writes).toEqual([]);
      await running?.close();
    }
  });

  it("does not tell her her yes was kept when the call was over by the time it came", async () => {
    const { store, twilio, now } = await serve([attempt({ state: "declined" })]);
    const reply = await twilio.post(shiftCallPath("answer", token(), TEST_STATE_KEY, now.at), outboundFields(sid("a"), { Digits: "1" }));
    expect(spokenIn(reply.body)).toEqual(["Sorry, I cannot take this call right now. Goodbye."]);
    expect(store.writes).toEqual([]);
  });

  it("does not serve the routes without a store, refuses other methods, and refuses a malformed request after its signature", async () => {
    const without = await serve([attempt()], false);
    expect((await without.twilio.post(shiftCallPath("answer", token(), TEST_STATE_KEY, without.now.at), outboundFields(sid("a")))).status).toBe(404);
    await running?.close();
    const { twilio, baseUrl, now } = await serve([attempt()]);
    expect((await fetch(baseUrl + shiftCallPath("answer", token(), TEST_STATE_KEY, now.at))).status).toBe(405);
    const noSid = Object.fromEntries(Object.entries(outboundFields(sid("a"))).filter(([name]) => name !== "CallSid"));
    expect((await twilio.post(shiftCallPath("answer", token(), TEST_STATE_KEY, now.at), noSid)).status).toBe(400);
  });
});

describe("when Twilio delivers a webhook more than once, or too early", () => {
  it("records her yes once however often the same request arrives, and answers each the same", async () => {
    const { store, twilio, baseUrl, now } = await serve([attempt()]);
    const first = await twilio.post(shiftCallPath("answer", token(), TEST_STATE_KEY, now.at), outboundFields(sid("a")));
    const path = first.body.match(/action="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&").replace(baseUrl, "") ?? "";
    const fields = outboundFields(sid("a"), { Digits: "1" });
    const [one, two, three] = [await twilio.post(path, fields), await twilio.post(path, fields), await twilio.post(path, fields)];
    expect([one.status, two.status, three.status]).toEqual([200, 200, 200]);
    expect(two.body).toBe(one.body);
    expect(three.body).toBe(one.body);
    expect(store.writes.filter((write) => write.kind === "word")).toHaveLength(1);
  });

  it("takes the first webhook for an attempt the worker has not yet recorded the ID of", async () => {
    const { store, twilio, now } = await serve([attempt({ callSid: null, state: "queued" })]);
    const first = await twilio.post(shiftCallPath("answer", token(), TEST_STATE_KEY, now.at), outboundFields(sid("a")));
    expect(spokenIn(first.body)).toHaveLength(4);
    expect(store.attempt(CIRCLE, SHIFT, 1)).toMatchObject({ callSid: sid("a"), state: "answered" });
    // Another call's ID cannot take an attempt that already has one.
    const other = await twilio.post(shiftCallPath("answer", token(), TEST_STATE_KEY, now.at), outboundFields(sid("f")));
    expect(spokenIn(other.body)).toEqual(["Sorry, I cannot take this call right now. Goodbye."]);
  });
});

describe("Twilio's status reports", () => {
  const report = async (state: MemoryShiftCall["state"], callStatus: string) => {
    const { store, twilio, now } = await serve([attempt({ state })]);
    const path = shiftCallPath("status", token(), TEST_STATE_KEY, now.at);
    const reply = await twilio.post(path, outboundFields(sid("a"), { CallStatus: callStatus }));
    const again = await twilio.post(path, outboundFields(sid("a"), { CallStatus: callStatus }));
    expect([reply.status, again.status]).toEqual([200, 200]);
    await running?.close();
    return store.writes;
  };

  it("records nothing while the call is still going", async () => {
    for (const status of ["queued", "ringing", "in-progress"]) expect(await report("calling", status), status).toEqual([]);
  });

  it("records a call nobody picked up, or that was busy, as unanswered, once", async () => {
    for (const status of ["no-answer", "busy", "completed"]) {
      expect(await report("calling", status), status).toEqual([{ kind: "ended", callSid: sid("a"), status: "no_answer", error: null }]);
    }
  });

  it("records a call that failed or was cancelled as failed, once", async () => {
    for (const status of ["failed", "canceled"]) {
      expect(await report("calling", status), status).toEqual([{ kind: "ended", callSid: sid("a"), status: "failed", error: "call_failed" }]);
    }
  });

  it("records a call she picked up and that ended with no word as failed, so the second attempt can follow", async () => {
    expect(await report("answered", "completed")).toEqual([{ kind: "ended", callSid: sid("a"), status: "failed", error: "no_word" }]);
  });

  it("leaves a call that already ended with her word as it is", async () => {
    for (const state of ["confirmed", "declined", "no_answer", "failed"] as const) expect(await report(state, "completed"), state).toEqual([]);
  });

  it("binds an attempt waiting for its ID when the report comes first", async () => {
    const { store, twilio, now } = await serve([attempt({ callSid: null, state: "queued" })]);
    await twilio.post(shiftCallPath("status", token(), TEST_STATE_KEY, now.at), outboundFields(sid("a"), { CallStatus: "no-answer" }));
    expect(store.attempt(CIRCLE, SHIFT, 1)).toMatchObject({ callSid: sid("a"), state: "no_answer" });
  });
});

describe("the office line is left as it was", () => {
  it("still refuses a shift call's token on the office line's routes", async () => {
    const { twilio, now } = await serve([attempt()]);
    const reply = await twilio.post(`/voice/turn?s=${encodeURIComponent(shiftCallPath("answer", token(), TEST_STATE_KEY, now.at).split("s=")[1] ?? "")}`, { CallSid: sid("a"), From: KIN_NUMBER, To: PARENT_NUMBER });
    expect(reply.status).toBe(400);
  });
});
