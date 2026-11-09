import {
  PRESENCE_ASK_ROUTES,
  endShiftCall,
  askShiftQuestion,
  callEnd,
  isPerson,
  openPresenceAskToken,
  parseShiftCallRequest,
  presenceAskUrl,
  presenceCallText,
  sealPresenceAskToken,
  understandAnswer,
  cleanSpeech,
  type FormParams,
  type OfficeLocale,
  type PresenceAskToken,
  type PresenceCallLine,
  type ShiftCallRequest,
  EMPTY_RESPONSE,
} from "@kin/telephony";
import type { VoiceDeps, VoiceHttpReply } from "../office-line-service.ts";
import type { PresenceLineStore } from "./presence-line-store.ts";

/**
 * Kin's call to the real person, after their text went unanswered for thirty seconds: "was that you?". The worker places
 * the call and gives Twilio these two addresses, each carrying a sealed token (circle, check, language; identifiers only).
 *
 * Who the call is about is decided in this order, and each step stops the request: Twilio's signature (checked before this
 * module is reached); the sealed token, under Kin's own key and not expired; the database, as Kin's service for that
 * circle, which accepts an answer only from the very call it recorded for this check. A machine is never asked: nothing
 * about the family is left on a voicemail. Yes, no and unclear are plain code (`understandAnswer`): a doubtful answer is
 * no answer and changes nothing, and the person can always use the link in the text.
 */

/** Said when the call cannot go on: a forged or old address, a check that is over. Fixed, in English, and it names nobody. */
const SORRY = "Sorry, I cannot take this call right now. Goodbye.";
const xml = (body: string): VoiceHttpReply => ({ status: 200, type: "xml", body });
const sorry = (): VoiceHttpReply => xml(endShiftCall("en", [SORRY]));

export type PresenceAskRoute = "answer" | "turn" | "status";

export const PRESENCE_ASK_ROUTE_PATHS: ReadonlyMap<string, PresenceAskRoute> = new Map(Object.entries(PRESENCE_ASK_ROUTES).map(([name, path]) => [path, name as PresenceAskRoute]));

const sentence = (locale: OfficeLocale, facts: { readonly voiceName: string; readonly parentName: string; readonly claimedCents: number | null; readonly currency: string }, line: PresenceCallLine): string =>
  presenceCallText({ locale, currency: facts.currency, name: facts.voiceName, parentName: facts.parentName, claimedCents: facts.claimedCents }, line);

const turnUrl = (token: PresenceAskToken, deps: VoiceDeps): string => presenceAskUrl(deps.config.publicUrl, "turn", sealPresenceAskToken(token, deps.config.stateKey, deps.now()));

/** One verified webhook of the call to the real person, from its fields to the TwiML that replies. */
export async function handlePresenceAskRoute(route: PresenceAskRoute, params: FormParams, url: URL, deps: VoiceDeps, store: PresenceLineStore): Promise<VoiceHttpReply> {
  const sealed = url.searchParams.get("s");
  const token = sealed === null ? null : openPresenceAskToken(sealed, deps.config.stateKey, deps.now());
  if (token === null) {
    deps.log({ level: "warn", message: "voice.presence_ask.bad_token", route });
    return sorry();
  }
  const call = parseShiftCallRequest(params);
  if (call === null) {
    deps.log({ level: "warn", message: "voice.presence_ask.malformed_request", route });
    return { status: 400, type: "text", body: "Bad request" };
  }
  if (route === "status") return presenceAskStatus();
  return route === "answer" ? answered(call, token, deps, store) : turn(call, token, deps, store);
}

/** The person picked up. Kin tells them what was asked and listens for yes or no. */
async function answered(call: ShiftCallRequest, token: PresenceAskToken, deps: VoiceDeps, store: PresenceLineStore): Promise<VoiceHttpReply> {
  // A voicemail greeting is never read the family's business, and a call that reports its end is not asked anything.
  if (!isPerson(call.answeredBy) || callEnd(call.callStatus) !== null) return xml(endShiftCall(token.locale, []));
  const facts = await store.askFacts(token.circleId, token.checkId);
  if (facts === null || facts.expiresAt.getTime() <= deps.now()) return sorry();
  deps.log({ level: "info", message: "voice.presence_ask.answered", callSid: call.callSid });
  return xml(askShiftQuestion(token.locale, [sentence(token.locale, facts, "question")], turnUrl(token, deps)));
}

async function turn(call: ShiftCallRequest, token: PresenceAskToken, deps: VoiceDeps, store: PresenceLineStore): Promise<VoiceHttpReply> {
  const facts = await store.askFacts(token.circleId, token.checkId);
  if (facts === null) return sorry();
  const heard = understandAnswer({ speech: call.speech === null ? null : cleanSpeech(call.speech), digits: call.digits, locale: token.locale });
  if (heard === "unclear") {
    // Ask once more, and then leave it: the link in the text still works, and nothing was changed.
    if (token.reasked >= 1) return xml(endShiftCall(token.locale, [sentence(token.locale, facts, "unclear")]));
    return xml(askShiftQuestion(token.locale, [sentence(token.locale, facts, "reprompt")], turnUrl({ ...token, reasked: token.reasked + 1 }, deps)));
  }
  const answer = heard === "yes" ? "me" : "not_me";
  try {
    const result = await store.answerByCall({ circleId: token.circleId, checkId: token.checkId, callSid: call.callSid, answer });
    deps.log({ level: "info", message: "voice.presence_ask.answer_recorded", callSid: call.callSid, answer, state: result.state });
  } catch {
    // The database refused: the check is over, or this is not the call recorded for it. Nothing is changed, and Kin says so plainly.
    deps.log({ level: "warn", message: "voice.presence_ask.answer_refused", callSid: call.callSid });
    return xml(endShiftCall(token.locale, [sentence(token.locale, facts, "unclear")]));
  }
  return xml(endShiftCall(token.locale, [sentence(token.locale, facts, answer === "me" ? "thanksYes" : "thanksNo")]));
}

/** Twilio's report on the call's progress needs no answer: the check is only ever changed by a word on the call itself. */
export const presenceAskStatus = (): VoiceHttpReply => xml(EMPTY_RESPONSE);
