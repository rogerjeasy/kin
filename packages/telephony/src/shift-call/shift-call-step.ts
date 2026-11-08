import type { ShiftCallAnswer } from "@kin/domain";

import { endShiftCall, openShiftCall, reaskShiftCall } from "./shift-call-twiml.ts";
import { MAX_SHIFT_REASKS, sealShiftCallToken, shiftCallUrl, type ShiftCallToken } from "./shift-call-token.ts";
import { isPerson, type AnsweredBy } from "./shift-call-request.ts";
import { shiftCallSentences, speakableName, type ShiftCallFacts } from "./shift-call-words.ts";
import { understandAnswer } from "./understand-answer.ts";

/** What the phone service holds to turn a token into the address of the next turn. */
export type ShiftCallSigning = { readonly publicUrl: string; readonly key: string; readonly now: number };

/** The record's facts for the sentences; the language is the token's. */
export type ShiftCallRecordFacts = Omit<ShiftCallFacts, "locale">;

/**
 * How a turn ended, for the phone service to record:
 * - `asked`: the question was put (first time) and Kin waits for the answer.
 * - `reasked`: silence or an unclear answer; Kin asked once more.
 * - `confirmed`: a clear yes. The family's second key.
 * - `declined`: a clear no. Nothing is paid; the family is told.
 * - `gave_up`: still unclear after the second ask. Nothing is recorded and the family decides.
 * - `voicemail`: a machine answered. Kin hung up having said nothing.
 */
export type ShiftCallOutcome = "asked" | "reasked" | "confirmed" | "declined" | "gave_up" | "voicemail";

export type ShiftCallTurn = {
  readonly outcome: ShiftCallOutcome;
  /** What was understood, when the parent answered. Only a `yes` is a word. */
  readonly answer: ShiftCallAnswer | null;
  readonly twiml: string;
};

const answerUrl = (signing: ShiftCallSigning, token: ShiftCallToken): string =>
  shiftCallUrl(signing.publicUrl, "answer", sealShiftCallToken(token, signing.key, signing.now));

/** The first turn, when Twilio asks Kin what to say after the parent picks up. */
export function startShiftCall(input: { token: ShiftCallToken; facts: ShiftCallRecordFacts; answeredBy: AnsweredBy | null; signing: ShiftCallSigning }): ShiftCallTurn {
  const { token, facts, answeredBy, signing } = input;
  if (!isPerson(answeredBy)) return { outcome: "voicemail", answer: null, twiml: endShiftCall(token.locale, []) };
  const sentences = shiftCallSentences({ ...facts, locale: token.locale });
  return { outcome: "asked", answer: null, twiml: openShiftCall(token.locale, sentences, answerUrl(signing, token)) };
}

/** The turn after the parent answers, or says nothing. */
export function continueShiftCall(input: {
  token: ShiftCallToken;
  facts: ShiftCallRecordFacts;
  heard: { readonly speech: string | null; readonly digits: string | null };
  signing: ShiftCallSigning;
}): ShiftCallTurn {
  const { token, facts, heard, signing } = input;
  const sentences = shiftCallSentences({ ...facts, locale: token.locale });
  const answer = understandAnswer({ ...heard, locale: token.locale, names: [speakableName(facts.caregiverName)] });
  if (answer === "yes") return { outcome: "confirmed", answer, twiml: endShiftCall(token.locale, sentences.confirmed) };
  if (answer === "no") return { outcome: "declined", answer, twiml: endShiftCall(token.locale, sentences.declined) };
  if (token.reasked >= MAX_SHIFT_REASKS) return { outcome: "gave_up", answer, twiml: endShiftCall(token.locale, sentences.unclear) };
  const next = { ...token, reasked: token.reasked + 1 };
  return { outcome: "reasked", answer, twiml: reaskShiftCall(token.locale, sentences, answerUrl(signing, next)) };
}
