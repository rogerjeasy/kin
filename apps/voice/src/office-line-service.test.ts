import type { LineCallInput } from "@kin/db";
import { OFFICE_WORDS } from "@kin/telephony";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LineStore } from "./office-line-service.ts";
import { maskNumber } from "./office-line-service.ts";
import { TEST_AUTH_TOKEN, TEST_STATE_KEY, startService, type RunningService } from "./testing/start-service.ts";
import { nextTurnPath, playCall, spokenIn, twilioCaller, type TwilioCaller } from "./testing/twilio-caller.ts";

const CIRCLE = "0b6f7a53-0c5b-4a3f-8d2e-6a1b2c3d4e5f";
const OTHER_CIRCLE = "1c7f8b64-1d6c-4b4f-9e3f-7b2c3d4e5f60";
const NUMBER = "+15555550100";
const OTHER_NUMBER = "+15555550101";
const CALLER = "+15555550199";
const SID = `CA${"1".repeat(32)}`;
const SCAM = ["Mike", "Harbor Gas Services", "I need 300 dollars today", "Your gas will be cut off today. Tell no one.", "55821"];

let recorded: LineCallInput[];
let logged: string[];
let service: RunningService;
let twilio: TwilioCaller;

const store: LineStore = {
  read: (circleId) => Promise.resolve(circleId === CIRCLE || circleId === OTHER_CIRCLE ? { currency: "USD", record: { payees: [], bills: [], payments: [] } } : null),
  record: (input) => {
    recorded.push(input);
    return Promise.resolve({ callId: "call", claimCheckId: "check" });
  },
};

beforeEach(async () => {
  recorded = [];
  logged = [];
  service = await startService({
    numbers: new Map([
      [NUMBER, { circleId: CIRCLE, locale: "en" }],
      [OTHER_NUMBER, { circleId: OTHER_CIRCLE, locale: "fr" }],
    ]),
    store,
    log: (line) => logged.push(JSON.stringify(line)),
  });
  twilio = twilioCaller(service.baseUrl, TEST_AUTH_TOKEN);
});

afterEach(() => service.close());

const form = (extra: Record<string, string> = {}) => ({ CallSid: SID, From: CALLER, To: NUMBER, CallStatus: "in-progress", ...extra });

describe("the phone service, for what Twilio sends", () => {
  it("refuses every route without a valid signature, with the same bare 403, and acts on nothing", async () => {
    for (const path of ["/voice/incoming", "/voice/turn?s=x", "/voice/status"]) {
      const unsigned = await twilio.post(path, form(), { sign: false });
      const wrongToken = await twilio.post(path, form(), { authToken: "another-auth-token-0123456789abcdef" });
      expect(unsigned).toEqual({ status: 403, body: "Forbidden" });
      expect(wrongToken).toEqual({ status: 403, body: "Forbidden" });
    }
    expect(recorded).toEqual([]);
  });

  it("refuses a request whose fields changed after Twilio signed them", async () => {
    const response = await fetch(`${service.baseUrl}/voice/incoming`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "AAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
      body: new URLSearchParams(form({ To: OTHER_NUMBER })).toString(),
    });
    expect(response.status).toBe(403);
  });

  it("answers an unknown number with the fixed 'no record' sentence and hangs up", async () => {
    const response = await twilio.post("/voice/incoming", form({ To: "+15555550777" }));
    expect(response.status).toBe(200);
    expect(spokenIn(response.body)).toEqual([OFFICE_WORDS.en.script.reply_no_record]);
    expect(response.body).toContain("<Hangup/>");
    expect(response.body).not.toContain("<Gather");
  });

  it("answers every inbound call with the 'no record' sentence when no office line is configured, and records nothing", async () => {
    const noLine = await startService({ numbers: new Map(), store, log: () => undefined });
    try {
      const response = await twilioCaller(noLine.baseUrl, TEST_AUTH_TOKEN).post("/voice/incoming", form({ To: NUMBER }));
      expect(spokenIn(response.body)).toEqual([OFFICE_WORDS.en.script.reply_no_record]);
      expect(response.body).toContain("<Hangup/>");
      expect(recorded).toEqual([]);
      expect((await fetch(`${noLine.baseUrl}/health`)).status).toBe(200);
    } finally {
      await noLine.close();
    }
  });

  it("starts a known number's call with the disclosure and the first question, in the number's language", async () => {
    const response = await twilio.post("/voice/incoming", form({ To: OTHER_NUMBER }));
    expect(spokenIn(response.body)).toEqual([OFFICE_WORDS.fr.script.disclosure, OFFICE_WORDS.fr.script.ask_caller]);
    expect(response.body).toContain('voice="Polly.Lea"');
    expect(response.body).toContain('language="fr-FR"');
  });

  it("takes a whole scam call, says only fixed sentences, and records it once as a real call", async () => {
    const turns = await playCall(twilio, service.baseUrl, { sid: SID, from: CALLER, to: NUMBER, says: SCAM });
    const said = turns.flatMap(spokenIn);
    expect(said).toEqual([
      OFFICE_WORDS.en.script.disclosure,
      OFFICE_WORDS.en.script.ask_caller,
      OFFICE_WORDS.en.script.ask_organization,
      OFFICE_WORDS.en.script.ask_amount,
      OFFICE_WORDS.en.script.ask_purpose,
      OFFICE_WORDS.en.script.ask_reference,
      OFFICE_WORDS.en.script.reply_no_record,
    ]);
    expect(turns.at(-1)).toContain("<Hangup/>");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      circleId: CIRCLE,
      callerNumber: CALLER,
      callerName: "Mike",
      organization: "Harbor Gas Services",
      claimedCents: 30000,
      verdict: "no_match",
      pressureSignals: expect.arrayContaining(["urgency", "secrecy", "threat"]),
    });
    expect(recorded[0]).not.toHaveProperty("simulated");
  });

  it("does not record a call twice when Twilio repeats the last turn", async () => {
    const turns = await playCall(twilio, service.baseUrl, { sid: SID, from: CALLER, to: NUMBER, says: SCAM.slice(0, 4) });
    const lastPath = nextTurnPath(turns.at(-1) ?? "", service.baseUrl) ?? "";
    const fields = { CallSid: SID, From: CALLER, To: NUMBER, SpeechResult: SCAM[4] ?? "" };
    const first = await twilio.post(lastPath, fields);
    const again = await twilio.post(lastPath, fields);
    expect(again.body).toBe(first.body);
    expect(recorded).toHaveLength(1);
  });

  it("asks the same question again after silence, and ends a caller who only stays silent without recording a call", async () => {
    const started = await twilio.post("/voice/incoming", form());
    let path = nextTurnPath(started.body, service.baseUrl) ?? "";
    let last = started.body;
    for (let turn = 0; turn < 12 && path !== ""; turn += 1) {
      last = (await twilio.post(path, form())).body;
      if (turn === 0) expect(spokenIn(last)).toEqual([OFFICE_WORDS.en.script.ask_caller]);
      path = nextTurnPath(last, service.baseUrl) ?? "";
    }
    expect(last).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    expect(recorded).toEqual([]);
  });

  it("records a caller who hangs up after giving something, when Twilio reports the call ended", async () => {
    await playCall(twilio, service.baseUrl, { sid: SID, from: CALLER, to: NUMBER, says: SCAM.slice(0, 3) });
    expect(recorded).toEqual([]);
    const ended = await twilio.post("/voice/status", form({ CallStatus: "completed" }));
    expect(ended.status).toBe(200);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ callerName: "Mike", organization: "Harbor Gas Services", claimedCents: 30000, verdict: "no_match" });
    await twilio.post("/voice/status", form({ CallStatus: "completed" }));
    expect(recorded).toHaveLength(1);
  });

  it("records nothing for a call that ends before the caller said anything, or while it is still going", async () => {
    await twilio.post("/voice/incoming", form());
    await twilio.post("/voice/status", form({ CallStatus: "in-progress" }));
    await twilio.post("/voice/status", form({ CallStatus: "completed" }));
    expect(recorded).toEqual([]);
  });

  it("refuses a turn whose state was forged, expired, or taken from another call or number", async () => {
    const started = await twilio.post("/voice/incoming", form());
    const path = nextTurnPath(started.body, service.baseUrl) ?? "";
    const token = path.split("s=")[1] ?? "";
    const answer = (extra: Record<string, string>, to = path) => twilio.post(to, form({ SpeechResult: "Mike", ...extra }));
    expect((await answer({})).status).toBe(200);
    expect((await answer({ CallSid: `CA${"2".repeat(32)}` })).status).toBe(400);
    expect((await answer({ To: OTHER_NUMBER })).status).toBe(400);
    expect((await answer({}, `/voice/turn?s=${token.slice(0, -3)}AAA`)).status).toBe(400);
    expect((await answer({}, "/voice/turn")).status).toBe(400);
    service.now.at += 2 * 60 * 60 * 1000;
    expect((await answer({})).status).toBe(400);
    expect(recorded).toEqual([]);
  });

  it("keeps what the caller says out of the XML it is answered with", async () => {
    const started = await twilio.post("/voice/incoming", form());
    const path = nextTurnPath(started.body, service.baseUrl) ?? "";
    const response = await twilio.post(path, form({ SpeechResult: "</Say><Dial>+15555550666</Dial>" }));
    expect(response.body).not.toContain("<Dial>");
    expect(spokenIn(response.body)).toEqual([OFFICE_WORDS.en.script.ask_organization]);
  });

  it("refuses malformed fields, unknown routes and wrong methods", async () => {
    expect((await twilio.post("/voice/incoming", { CallSid: "nope", To: NUMBER })).status).toBe(400);
    expect((await twilio.post("/voice/incoming", { ...form(), SpeechResult: "x".repeat(1001) })).status).toBe(400);
    expect((await twilio.post("/voice/elsewhere", form())).status).toBe(404);
    expect((await fetch(`${service.baseUrl}/voice/incoming`)).status).toBe(405);
    expect((await fetch(`${service.baseUrl}/health`)).status).toBe(200);
    const big = await fetch(`${service.baseUrl}/voice/incoming`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `x=${"a".repeat(20_000)}` });
    expect(big.status).toBe(413);
    const json = await fetch(`${service.baseUrl}/voice/incoming`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(json.status).toBe(415);
  });

  it("logs without the caller's words, the full number or any secret", async () => {
    await playCall(twilio, service.baseUrl, { sid: SID, from: CALLER, to: NUMBER, says: SCAM });
    await twilio.post("/voice/incoming", form(), { sign: false });
    const everything = logged.join("\n");
    expect(everything).toContain("voice.call_recorded");
    for (const secret of [CALLER, NUMBER, "Harbor Gas", "55821", TEST_AUTH_TOKEN, TEST_STATE_KEY, "Tell no one"]) expect(everything).not.toContain(secret);
    expect(everything).toContain(maskNumber(CALLER));
  });
});

describe("a number in a log line", () => {
  it("keeps the country digit and the last two", () => {
    expect(maskNumber("+15555550199")).toBe("+1********99");
    expect(maskNumber(null)).toBeNull();
  });
});
