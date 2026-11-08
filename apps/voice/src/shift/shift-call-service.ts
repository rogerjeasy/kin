import { ShiftCallError, ShiftError } from "@kin/db";
import { shiftCallIsActive, type ShiftCallState } from "@kin/domain";
import {
  EMPTY_RESPONSE,
  callEnd,
  continueShiftCall,
  openShiftCallToken,
  parseShiftCallRequest,
  sayAndHangUp,
  startShiftCall as firstShiftCallTurn,
  type FormParams,
  type ShiftCallRequest,
  type ShiftCallToken,
  type ShiftCallTurn,
} from "@kin/telephony";

import type { VoiceDeps, VoiceHttpReply } from "../office-line-service.ts";
import type { ShiftCallStore } from "./shift-call-store.ts";

/**
 * The two webhooks of Kin's call to the parent about a shift. The worker
 * places the call and gives Twilio their addresses, each carrying a sealed
 * token (circle, shift, attempt, language); nothing here is configured on a number.
 *
 * Who the call is for is decided in this order, and each step stops the request:
 * 1. Twilio's signature over the exact address and fields (checked before this module is reached);
 * 2. the sealed token, under Kin's own key and not expired, which alone names the circle;
 * 3. the database, as Kin's service for that circle, finding the attempt the token names and
 *    holding the request's `CallSid` to the one recorded on it (`ShiftCallStore.open`).
 * The names and the part of the day come from the record, never from the token or the request.
 */

/** Said when the call cannot go on: a forged or old address, a call that is not Kin's, one already over, a refusal the database made. Fixed, in English, and it names nobody. */
const SORRY = "Sorry, I cannot take this call right now. Goodbye.";
/** The states in which the call's own webhook may still be answered: live, or ended by a word (a repeat of that word's request gets the same reply). */
const ANSWERABLE: ReadonlySet<ShiftCallState> = new Set(["calling", "answered", "confirmed", "declined"]);
const xml = (body: string): VoiceHttpReply => ({ status: 200, type: "xml", body });
const sorry = (): VoiceHttpReply => xml(sayAndHangUp("en", [SORRY]));

export type ShiftCallRoute = "answer" | "status";

/** One verified webhook of a shift call, from its fields to the TwiML (or the empty answer) that replies. */
export async function handleShiftCallRoute(route: ShiftCallRoute, params: FormParams, url: URL, deps: VoiceDeps, store: ShiftCallStore): Promise<VoiceHttpReply> {
  const sealed = url.searchParams.get("s");
  const token = sealed === null ? null : openShiftCallToken(sealed, deps.config.stateKey, deps.now());
  if (token === null) {
    deps.log({ level: "warn", message: "voice.shift_call.bad_token", route });
    return route === "answer" ? sorry() : xml(EMPTY_RESPONSE);
  }
  const call = parseShiftCallRequest(params);
  if (call === null) {
    deps.log({ level: "warn", message: "voice.shift_call.malformed_request", route });
    return { status: 400, type: "text", body: "Bad request" };
  }
  return route === "answer" ? answer(call, token, deps, store) : status(call, token, deps, store);
}

const shiftOf = (token: ShiftCallToken) => ({ circleId: token.circleId, shiftId: token.shiftId });

async function answer(call: ShiftCallRequest, token: ShiftCallToken, deps: VoiceDeps, store: ShiftCallStore): Promise<VoiceHttpReply> {
  const record = await store.open({ ...shiftOf(token), attempt: token.attempt, callSid: call.callSid });
  if (record === null || !ANSWERABLE.has(record.state)) {
    deps.log({ level: "warn", message: "voice.shift_call.not_open", circleId: token.circleId, shiftId: token.shiftId, attempt: token.attempt, found: record !== null });
    return sorry();
  }
  const facts = { caregiverName: record.caregiverName, dayPart: record.dayPart, contactName: record.contactName };
  const signing = { publicUrl: deps.config.publicUrl, key: deps.config.stateKey, now: deps.now() };
  // The first request has nothing heard and the call still "calling". Every later one is the parent's answer, or her silence, to a question already asked.
  const first = record.state === "calling" && call.speech === null && call.digits === null;
  const turn = first
    ? firstShiftCallTurn({ token, facts, answeredBy: call.answeredBy, signing })
    : continueShiftCall({ token, facts, heard: { speech: call.speech, digits: call.digits }, signing });
  try {
    await persist(turn, call, token, store);
  } catch (error) {
    // The database would not take her word (the call is over, the parent is no longer the parent...). She is not told it was kept.
    if (!(error instanceof ShiftError || error instanceof ShiftCallError)) throw error;
    deps.log({ level: "warn", message: "voice.shift_call.refused", circleId: token.circleId, shiftId: token.shiftId, reason: error.reason });
    return sorry();
  }
  deps.log({ level: "info", message: "voice.shift_call.turn", circleId: token.circleId, shiftId: token.shiftId, attempt: token.attempt, outcome: turn.outcome });
  return xml(turn.twiml);
}

/**
 * Only a clear yes or no is a word. A question just asked, a question asked again and a still unclear answer
 * record nothing about the shift: the family decides. A machine is recorded as no answer.
 */
async function persist(turn: ShiftCallTurn, call: ShiftCallRequest, token: ShiftCallToken, store: ShiftCallStore): Promise<void> {
  const ref = { ...shiftOf(token), callSid: call.callSid };
  switch (turn.outcome) {
    case "confirmed":
      await store.recordWord({ ...ref, answer: "yes" });
      return;
    case "declined":
      await store.recordWord({ ...ref, answer: "no" });
      return;
    case "asked":
      await store.markAnswered(ref);
      return;
    case "voicemail":
      await store.reportEnd({ ...ref, status: "no_answer", error: "machine" });
      return;
    case "reasked":
    case "gave_up":
      return;
  }
}

/** Twilio's report on how the call went. Progress reports record nothing; an end is recorded once, and a repeat changes nothing. */
async function status(call: ShiftCallRequest, token: ShiftCallToken, deps: VoiceDeps, store: ShiftCallStore): Promise<VoiceHttpReply> {
  const end = callEnd(call.callStatus);
  if (end === null) return xml(EMPTY_RESPONSE);
  const record = await store.open({ ...shiftOf(token), attempt: token.attempt, callSid: call.callSid });
  if (record === null) {
    deps.log({ level: "warn", message: "voice.shift_call.not_open", circleId: token.circleId, shiftId: token.shiftId, attempt: token.attempt, found: false });
    return { status: 403, type: "text", body: "Forbidden" };
  }
  // A call over already (a word given, a machine, an earlier report) stays as it is.
  if (shiftCallIsActive(record.state)) {
    // Picked up and ended with no word, or failed: the attempt failed. Never picked up, or busy: nobody answered.
    const picked = record.state === "answered";
    const report = picked || end === "failed" ? "failed" : "no_answer";
    await store.reportEnd({ ...shiftOf(token), callSid: call.callSid, status: report, error: picked ? "no_word" : end === "failed" ? "call_failed" : undefined });
    deps.log({ level: "info", message: "voice.shift_call.ended", circleId: token.circleId, shiftId: token.shiftId, attempt: token.attempt, status: report });
  }
  return xml(EMPTY_RESPONSE);
}
