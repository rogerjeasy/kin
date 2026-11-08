import type { LineCallInput, LineRecord } from "@kin/db";
import { CLAIM_TOPIC } from "@kin/domain";
import {
  EMPTY_RESPONSE,
  MAX_FORM_BYTES,
  OFFICE_WORDS,
  cleanSpeech,
  familyAlert,
  openCallState,
  parseVoiceRequest,
  replayCall,
  sayAndHangUp,
  sayAndListen,
  sealCallState,
  verifyTwilioSignature,
  type CallOutcome,
  type CallState,
  type FormParams,
  type VoiceRequest,
} from "@kin/telephony";

import type { CallBook } from "./call-book.ts";
import type { LineTarget, VoiceConfig } from "./config.ts";

/** What the service needs from outside itself. The database sits behind `store`; tests and the demo script supply their own. */
export type LineStore = {
  /** The record of a circle, or `null` when the circle is closed. */
  read(circleId: string): Promise<LineRecord | null>;
  record(input: LineCallInput): Promise<{ callId: string; claimCheckId: string }>;
};

export type VoiceLog = (line: Readonly<Record<string, string | number | boolean | null>>) => void;

export type VoiceDeps = {
  readonly config: Pick<VoiceConfig, "numbers" | "authToken" | "stateKey" | "publicUrl">;
  readonly store: LineStore;
  readonly calls: CallBook;
  readonly now: () => number;
  readonly log: VoiceLog;
};

export type VoiceHttpRequest = {
  readonly method: string;
  /** The path and query as the request line carries them. */
  readonly target: string;
  readonly signature: string | undefined;
  readonly body: string;
};

export type VoiceHttpReply = { readonly status: number; readonly type: "xml" | "text"; readonly body: string };

const xml = (body: string): VoiceHttpReply => ({ status: 200, type: "xml", body });
const refuse = (status: 400 | 403 | 404 | 405 | 413 | 500, body: string): VoiceHttpReply => ({ status, type: "text", body });

/** The calls that are over. Anything else is Twilio telling Kin a call is still going. */
const ENDED = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);

/** A number for a log line: enough to tell calls apart, not enough to call back. */
export function maskNumber(number: string | null): string | null {
  return number === null ? null : `${number.slice(0, 2)}${"*".repeat(Math.max(number.length - 4, 0))}${number.slice(-2)}`;
}

/**
 * One Twilio webhook, from the request to the TwiML (or refusal) that answers it.
 * Nothing is read from the body, stored or acted on until Twilio's signature
 * over the exact URL and fields has been verified; a request that fails it gets
 * the same bare 403 whatever was wrong with it.
 */
export async function handleVoice(request: VoiceHttpRequest, deps: VoiceDeps): Promise<VoiceHttpReply> {
  const url = new URL(request.target, "http://placeholder.invalid");
  if (url.pathname === "/health") return { status: 200, type: "text", body: "ok" };
  const route = ROUTES[url.pathname];
  if (route === undefined) return refuse(404, "Not found");
  if (request.method !== "POST") return refuse(405, "Method not allowed");
  if (request.body.length > MAX_FORM_BYTES) return refuse(413, "Too large");

  const params: FormParams = [...new URLSearchParams(request.body)];
  const signed = verifyTwilioSignature({ url: deps.config.publicUrl + request.target, params, header: request.signature, authToken: deps.config.authToken });
  if (!signed) {
    deps.log({ level: "warn", message: "voice.unsigned_request", path: url.pathname });
    return refuse(403, "Forbidden");
  }
  const call = parseVoiceRequest(params);
  if (call === null) {
    deps.log({ level: "warn", message: "voice.malformed_request", path: url.pathname });
    return refuse(400, "Bad request");
  }
  try {
    return await route(call, url, deps);
  } catch (error) {
    // Never the message: it can carry SQL or a caller's words.
    deps.log({ level: "error", message: "voice.failed", path: url.pathname, error: error instanceof Error ? error.name : "unknown" });
    return refuse(500, "Server error");
  }
}

type Route = (call: VoiceRequest, url: URL, deps: VoiceDeps) => Promise<VoiceHttpReply>;
const ROUTES: Readonly<Record<string, Route>> = { "/voice/incoming": incoming, "/voice/turn": turn, "/voice/status": status };

/** The address Twilio posts the caller's next answer to: the next state, sealed. */
const turnUrl = (state: CallState, deps: VoiceDeps): string => `${deps.config.publicUrl}/voice/turn?s=${sealCallState(state, deps.config.stateKey, deps.now())}`;

/** The number dialled picks the circle. The caller's number is recorded as a claim and is never consulted. */
const targetOf = (call: VoiceRequest, deps: VoiceDeps): LineTarget | undefined => deps.config.numbers.get(call.to);

/** What an unknown number hears: the fixed "no record" sentence in English, then the line drops. */
function notOurNumber(): VoiceHttpReply {
  return xml(sayAndHangUp("en", [OFFICE_WORDS.en.script.reply_no_record]));
}

async function incoming(call: VoiceRequest, _url: URL, deps: VoiceDeps): Promise<VoiceHttpReply> {
  const target = targetOf(call, deps);
  const line = target === undefined ? null : await deps.store.read(target.circleId);
  if (target === undefined || line === null) {
    deps.log({ level: "info", message: "voice.unknown_number", to: maskNumber(call.to) });
    return notOurNumber();
  }
  const state: CallState = { sid: call.callSid, circle: target.circleId, locale: target.locale, from: call.from, heard: [], silent: 0 };
  const replay = await replayCall({ ...state, script: OFFICE_WORDS[target.locale].script, record: line.record, currency: line.currency });
  deps.calls.set(call.callSid, state, false);
  deps.log({ level: "info", message: "voice.call_started", callSid: call.callSid, circleId: target.circleId, from: maskNumber(call.from) });
  return xml(sayAndListen(target.locale, replay.sentences, turnUrl(state, deps)));
}

async function turn(call: VoiceRequest, url: URL, deps: VoiceDeps): Promise<VoiceHttpReply> {
  const token = url.searchParams.get("s");
  const sealed = token === null ? null : openCallState(token, deps.config.stateKey, deps.now());
  // The token must belong to this very call and to the circle this number answers for.
  if (sealed === null || sealed.sid !== call.callSid || targetOf(call, deps)?.circleId !== sealed.circle) {
    deps.log({ level: "warn", message: "voice.bad_state", callSid: call.callSid });
    return refuse(400, "Bad request");
  }
  const line = await deps.store.read(sealed.circle);
  if (line === null) return notOurNumber();

  const answer = call.speech === null ? "" : cleanSpeech(call.speech);
  const state: CallState = answer === "" ? { ...sealed, silent: sealed.silent + 1 } : { ...sealed, heard: [...sealed.heard, answer] };
  const replay = await replayCall({ ...state, script: OFFICE_WORDS[state.locale].script, record: line.record, currency: line.currency });

  if (replay.awaiting) {
    deps.calls.set(call.callSid, state, false);
    return xml(sayAndListen(state.locale, replay.sentences, turnUrl(state, deps)));
  }
  // The intake ran to its end, or the caller went on past the turn limit: Kin says its last words, if any, and hangs up.
  await finish(state, replay.outcome, line.currency, deps);
  deps.log({ level: "info", message: "voice.call_finished", callSid: call.callSid, completed: replay.outcome.completed });
  return xml(sayAndHangUp(state.locale, replay.outcome.completed ? replay.sentences : []));
}

/** Twilio's report that a call has ended. A caller who hung up having said something is recorded once. */
async function status(call: VoiceRequest, _url: URL, deps: VoiceDeps): Promise<VoiceHttpReply> {
  const open = deps.calls.get(call.callSid);
  if (call.callStatus === null || !ENDED.has(call.callStatus) || open === undefined || open.recorded) return xml(EMPTY_RESPONSE);
  const line = await deps.store.read(open.state.circle);
  if (line === null) return xml(EMPTY_RESPONSE);
  const { state } = open;
  const replay = await replayCall({ ...state, script: OFFICE_WORDS[state.locale].script, record: line.record, currency: line.currency });
  await finish(state, replay.outcome, line.currency, deps);
  deps.log({ level: "info", message: "voice.call_hung_up", callSid: call.callSid, checked: replay.outcome.verdict !== null });
  return xml(EMPTY_RESPONSE);
}

/** Records a call with something to check, once, as the service for the one circle. A call with nothing said records nothing. */
async function finish(state: CallState, outcome: CallOutcome, currency: string, deps: VoiceDeps): Promise<void> {
  await deps.calls.once(state.sid, async () => {
    if (deps.calls.get(state.sid)?.recorded === true) return;
    if (outcome.verdict !== null) {
      const recorded = await deps.store.record(lineCall(state, outcome, currency));
      deps.log({ level: "info", message: "voice.call_recorded", callSid: state.sid, circleId: state.circle, callId: recorded.callId, verdict: outcome.verdict.result.verdict });
    }
    deps.calls.set(state.sid, state, true);
  });
}

function lineCall(state: CallState, outcome: CallOutcome, currency: string): LineCallInput {
  const { verdict, intake } = outcome;
  if (verdict === null) throw new Error("A call with nothing to check has nothing to record");
  const { answers } = intake;
  const alert = familyAlert(state.locale, currency, verdict, answers);
  return {
    circleId: state.circle,
    callSid: state.sid,
    callerNumber: state.from,
    callerName: answers.caller,
    organization: answers.organization,
    claimedCents: verdict.claimedCents,
    purpose: answers.purpose,
    reference: answers.reference,
    transcript: outcome.transcript,
    pressureSignals: verdict.pressure,
    payeeId: verdict.result.payeeId,
    foundEntryId: verdict.result.lastPayment?.entryId ?? null,
    verdict: verdict.result.verdict,
    topic: CLAIM_TOPIC[verdict.result.verdict],
    spoken: alert.spoken,
    claim: alert.claim,
  };
}

