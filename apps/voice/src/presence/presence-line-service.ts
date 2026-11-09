import { newCheckToken } from "@kin/db";
import { calendarDay, codeReply, presenceReply, type PresenceReply } from "@kin/domain";
import {
  MAX_PRESENCE_REASKS,
  MAX_PRESENCE_WAITS,
  OFFICE_WORDS,
  PRESENCE_CALL_ROUTES,
  PRESENCE_WAIT_SECONDS,
  PRESENCE_WORDS,
  cleanSpeech,
  familyCode,
  matchesFamilyCode,
  openPresenceCallToken,
  parseVoiceRequest,
  planPresenceCheck,
  presenceCallUrl,
  presenceReplyText,
  sayAndHangUp,
  sayAndListen,
  sayPauseAndRedirect,
  sealPresenceCallToken,
  type FormParams,
  type OfficeLocale,
  type PresenceCallToken,
  type VoiceRequest,
} from "@kin/telephony";

import type { LineTarget } from "../config.ts";
import type { VoiceDeps, VoiceHttpReply } from "../office-line-service.ts";
import type { PresenceLineStore } from "./presence-line-store.ts";

/**
 * Kin's "is it really you?" line: the number a parent rings when a voice that
 * says it is family has asked for money. Kin says what it is, listens once to
 * what the parent was told, and hands the account to `planPresenceCheck`: plain
 * code reads it, finds the claimed person among the family's trusted voices and
 * opens a check, which texts that person's real phone. While they answer, Kin
 * keeps the parent on the line and looks at the check every few seconds, and
 * then says the one sentence the answer calls for. It has no tool that pays,
 * edits or discloses anything, and no model: the rules read the account just as
 * well, so the line works with the model down.
 *
 * Who the call is for is decided in this order: Twilio's signature (checked
 * before this module is reached); the number dialled, which alone picks the
 * circle; the sealed token, which holds the call's own ID. The caller's number
 * is never consulted: anyone may ring, and all a ring can do is text the real
 * family member "is this you?", a few times an hour at most.
 */

const xml = (body: string): VoiceHttpReply => ({ status: 200, type: "xml", body });
const sorry = (): VoiceHttpReply => xml(sayAndHangUp("en", [OFFICE_WORDS.en.script.reply_no_record]));

export type PresenceRoute = "incoming" | "turn" | "wait" | "code";

export const PRESENCE_ROUTE_PATHS: ReadonlyMap<string, PresenceRoute> = new Map(Object.entries(PRESENCE_CALL_ROUTES).map(([name, path]) => [path, name as PresenceRoute]));

export type PresenceLineDeps = {
  readonly numbers: ReadonlyMap<string, LineTarget>;
  readonly store: PresenceLineStore;
};

const seal = (token: PresenceCallToken, deps: VoiceDeps): string => sealPresenceCallToken(token, deps.config.stateKey, deps.now());
const next = (route: "turn" | "wait" | "code", token: PresenceCallToken, deps: VoiceDeps): string => presenceCallUrl(deps.config.publicUrl, route, seal(token, deps));

/** One verified webhook of the presence line, from its fields to the TwiML that replies. */
export async function handlePresenceRoute(route: PresenceRoute, params: FormParams, url: URL, deps: VoiceDeps, line: PresenceLineDeps): Promise<VoiceHttpReply> {
  const call = parseVoiceRequest(params);
  if (call === null) {
    deps.log({ level: "warn", message: "voice.presence.malformed_request", route });
    return { status: 400, type: "text", body: "Bad request" };
  }
  if (route === "incoming") return incoming(call, deps, line);
  const sealed = url.searchParams.get("s");
  const token = sealed === null ? null : openPresenceCallToken(sealed, deps.config.stateKey, deps.now());
  // The token must belong to this very call and to the circle this number answers for.
  if (token === null || token.sid !== call.callSid || line.numbers.get(call.to)?.circleId !== token.circleId) {
    deps.log({ level: "warn", message: "voice.presence.bad_token", route, callSid: call.callSid });
    return sorry();
  }
  if (route === "code") return code(call, token, deps, line);
  return route === "turn" ? turn(call, token, deps, line) : wait(call, token, deps, line);
}

async function incoming(call: VoiceRequest, deps: VoiceDeps, line: PresenceLineDeps): Promise<VoiceHttpReply> {
  const target = line.numbers.get(call.to);
  const circle = target === undefined ? null : await line.store.read(target.circleId);
  if (target === undefined || circle === null) {
    deps.log({ level: "info", message: "voice.presence.unknown_number" });
    return sorry();
  }
  deps.log({ level: "info", message: "voice.presence.call_started", callSid: call.callSid, circleId: target.circleId });
  const token: PresenceCallToken = { sid: call.callSid, circleId: target.circleId, locale: target.locale, checkId: null, reasked: 0, waits: 0 };
  return xml(sayAndListen(target.locale, [PRESENCE_WORDS[target.locale].line.intro], next("turn", token, deps)));
}

async function turn(call: VoiceRequest, token: PresenceCallToken, deps: VoiceDeps, line: PresenceLineDeps): Promise<VoiceHttpReply> {
  const words = PRESENCE_WORDS[token.locale];
  const account = call.speech === null ? "" : cleanSpeech(call.speech);
  if (account === "") {
    // Silence: ask once more, and then leave it. Nothing was said, so nothing is checked.
    if (token.reasked >= MAX_PRESENCE_REASKS) return xml(sayAndHangUp(token.locale, []));
    return xml(sayAndListen(token.locale, [words.line.notHeard], next("turn", { ...token, reasked: token.reasked + 1 }, deps)));
  }
  const circle = await line.store.read(token.circleId);
  if (circle === null) return sorry();
  const plan = await planPresenceCheck({ said: [account], voices: circle.voices, locale: token.locale, currency: circle.currency, parentName: circle.parentName });
  if (plan === null) return xml(sayAndHangUp(token.locale, []));
  const opened = await line.store.open({
    circleId: token.circleId,
    callSid: call.callSid,
    voiceId: plan.voiceId,
    claimedName: plan.claimedName,
    claimedRelationship: plan.claimedRelationship,
    claimedCents: plan.claimedCents,
    markers: plan.markers,
    said: plan.said,
    locale: token.locale,
    token: newCheckToken(),
    alerts: plan.alerts,
  });
  deps.log({ level: "info", message: "voice.presence.check_opened", callSid: call.callSid, checkId: opened.checkId, state: opened.state, markers: plan.markers.length, byModel: plan.byModel });
  const facts = { locale: token.locale, currency: circle.currency, name: plan.voiceName ?? plan.claimedName, parentName: circle.parentName, claimedCents: null };
  const reply = presenceReply({ state: opened.state, matched: plan.voiceId !== null });
  // Nobody on the list to ask: the caller can still be asked for the weekly family code, which only real family know.
  if (reply !== "checking") return xml(askForCode(token, [presenceReplyText(facts, reply)], deps));
  const waiting: PresenceCallToken = { ...token, checkId: opened.checkId, reasked: 0, waits: 0 };
  return xml(sayPauseAndRedirect(token.locale, [presenceReplyText(facts, "checking")], PRESENCE_WAIT_SECONDS, next("wait", waiting, deps)));
}

/** One more look at the check: the parent hears its answer as soon as there is one, and otherwise waits a few seconds more. */
async function wait(call: VoiceRequest, token: PresenceCallToken, deps: VoiceDeps, line: PresenceLineDeps): Promise<VoiceHttpReply> {
  const { checkId } = token;
  const circle = checkId === null ? null : await line.store.read(token.circleId);
  const check = checkId === null || circle === null ? null : await line.store.status(token.circleId, checkId);
  if (check === null || circle === null) return sorry();
  const facts = { locale: token.locale as OfficeLocale, currency: circle.currency, name: check.voiceName, parentName: circle.parentName, claimedCents: null };
  const reply: PresenceReply = presenceReply({ state: check.state, matched: true });
  if (reply !== "checking") {
    deps.log({ level: "info", message: "voice.presence.call_finished", callSid: call.callSid, reply });
    // Nobody could be reached: Rose may still ask the caller for the weekly family code. An answer, yes or no, ends the call.
    const unreached = reply === "unreachable";
    return xml(unreached ? askForCode(token, [presenceReplyText(facts, reply)], deps) : sayAndHangUp(token.locale, [presenceReplyText(facts, reply)]));
  }
  if (token.waits >= MAX_PRESENCE_WAITS) {
    // The check is still open after the longest Kin waits: the real person has not answered, and Kin says so.
    return xml(askForCode(token, [presenceReplyText(facts, "unreachable")], deps));
  }
  return xml(sayPauseAndRedirect(token.locale, [], PRESENCE_WAIT_SECONDS, next("wait", { ...token, waits: token.waits + 1 }, deps)));
}

/** Kin says what it has just said, then asks Rose to put the weekly family code to the caller and tell it what the caller says. */
const askForCode = (token: PresenceCallToken, sentences: readonly string[], deps: VoiceDeps): string =>
  sayAndListen(token.locale, [...sentences, PRESENCE_WORDS[token.locale].line.askCode], next("code", token, deps));

/**
 * What Rose says the caller answered when asked for the weekly family code. Plain code compares it with this week's three
 * words, worked out from the circle's secret seed and its own calendar day: a right code is not proof, only the absence of a
 * wrong one, and Kin says so; a wrong one, or none, is told plainly. Whatever she says is data, and is neither stored nor obeyed.
 */
async function code(call: VoiceRequest, token: PresenceCallToken, deps: VoiceDeps, line: PresenceLineDeps): Promise<VoiceHttpReply> {
  const circle = await line.store.read(token.circleId);
  if (circle === null) return sorry();
  const said = call.speech === null ? "" : cleanSpeech(call.speech);
  const facts = { locale: token.locale, currency: circle.currency, name: null, parentName: circle.parentName, claimedCents: null };
  if (said === "") return xml(sayAndHangUp(token.locale, [presenceReplyText(facts, "code_wrong")]));
  const seed = await line.store.familyCodeSeed(token.circleId);
  const today = calendarDay(new Date(deps.now()), circle.timezone).occurredOn;
  const reply = codeReply(matchesFamilyCode(said, familyCode(seed, today)));
  deps.log({ level: "info", message: "voice.presence.code_checked", callSid: call.callSid, reply });
  return xml(sayAndHangUp(token.locale, [presenceReplyText(facts, reply)]));
}
