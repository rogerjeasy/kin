import { TWILIO_VOICES, sayElement } from "../twilio/twiml.ts";
import { escapeXml } from "../twilio/xml.ts";
import type { OfficeLocale } from "../office-words.ts";
import type { ShiftCallSentences } from "./shift-call-words.ts";

/**
 * TwiML for the call that asks the parent for the family's word.
 *
 * Voice and language per locale are the office line's (`TWILIO_VOICES`), checked
 * against Twilio's text-to-speech table on 2026-11-08
 * (https://www.twilio.com/docs/voice/twiml/say/text-speech): Polly.Joanna
 * (en-US), Polly.Lea (fr-FR), Polly.Vicki (de-DE), Polly.Bianca (it-IT),
 * Polly.Lucia (es-ES) and Polly.Hala-Neural (ar-AE) exist; Hebrew has no Polly
 * voice, so it is spoken with Twilio's default voice for he-IL (Twilio's table
 * also lists Google he-IL voices, which would need a Google voice name).
 *
 * `<Gather>` per https://www.twilio.com/docs/voice/twiml/gather: `input="speech
 * dtmf"` gives precedence to the first input detected, `numDigits="1"` ends on
 * one key, `speechTimeout="auto"` ends at the first pause, `timeout` is the wait
 * for any input, `actionOnEmptyResult="true"` posts silence to Kin too, and
 * `hints` (up to 500 entries of 100 characters) names the expected words.
 *
 * What only a live Twilio account can prove, because these tests run against
 * documentation, not Twilio:
 * - that Twilio accepts the voice and language pair for each locale (Hebrew
 *   above all) and that the Arabic Neural voice is enabled for the account;
 * - that speech recognition in he-IL, ar-AE and the others returns the words
 *   in the lexicon's spelling (the parent can always press 1 or 2);
 * - that `hints` is honoured for Arabic and Hebrew (the page does not say);
 * - that `AnsweredBy` arrives at the answer webhook when machine detection is
 *   on, and how often a voicemail greeting is taken for a person;
 * - that the signature Twilio puts on the answer and status requests matches
 *   what `verifyTwilioSignature` computes for these query-carrying addresses;
 * - that an outbound call from the account's number is delivered to a real
 *   handset in each country, with its caller ID, and that the account is
 *   permitted to call it (geographic permissions, trial restrictions).
 */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>';
const GATHER_TIMEOUT_SECONDS = 8;

/** Words that help Twilio's recognizer expect an answer. Kept to the lexicon's plainest yes and no. */
const HINTS: Readonly<Record<OfficeLocale, string>> = {
  en: "yes, no, yeah, nope",
  fr: "oui, non",
  de: "ja, nein",
  it: "sì, no",
  es: "sí, no",
  ar: "نعم, لا",
  he: "כן, לא",
};

/**
 * Kin speaks, then listens. The sentences are said before the `<Gather>`, not
 * inside it: a parent who picks up with "Yes? Hello?" must not have that taken
 * for the answer. Barge-in is the price, and the question is short.
 */
export function askShiftQuestion(locale: OfficeLocale, sentences: readonly string[], actionUrl: string): string {
  const { listen } = TWILIO_VOICES[locale];
  const gather =
    `<Gather input="speech dtmf" numDigits="1" timeout="${GATHER_TIMEOUT_SECONDS}" speechTimeout="auto" method="POST" actionOnEmptyResult="true"` +
    ` language="${escapeXml(listen)}" hints="${escapeXml(HINTS[locale])}" action="${escapeXml(actionUrl)}"/>`;
  // Should Twilio ever fall through the Gather, the call ends instead of looping.
  return `${XML_HEAD}<Response>${sentences.map((each) => sayElement(locale, each)).join("")}${gather}<Hangup/></Response>`;
}

/** The first turn: the opening, then the question. */
export function openShiftCall(locale: OfficeLocale, sentences: ShiftCallSentences, actionUrl: string): string {
  return askShiftQuestion(locale, [...sentences.opening, sentences.question], actionUrl);
}

/** The second turn, after silence or an unclear answer: sorry, and the question again. */
export function reaskShiftCall(locale: OfficeLocale, sentences: ShiftCallSentences, actionUrl: string): string {
  return askShiftQuestion(locale, [sentences.reprompt, sentences.question], actionUrl);
}

/** Kin's last words, then the line closes. No words for an answering machine: Kin leaves nothing on a voicemail. */
export function endShiftCall(locale: OfficeLocale, sentences: readonly string[]): string {
  return `${XML_HEAD}<Response>${sentences.map((each) => sayElement(locale, each)).join("")}<Hangup/></Response>`;
}
