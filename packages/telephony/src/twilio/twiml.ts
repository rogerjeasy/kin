import type { OfficeLocale } from "../office-words.ts";
import { escapeXml } from "./xml.ts";

/**
 * How Twilio speaks and hears each language. The voices are Amazon Polly's,
 * which Twilio serves by name. Hebrew has no Polly voice, so it names none and
 * Twilio speaks it with its default voice for the language; Arabic's Polly
 * voice is neural-only, hence its suffix. These names are Twilio's to accept:
 * they are the part of the phone line that only a live Twilio account proves.
 */
export type TwilioVoice = {
  readonly voice: string | null;
  /** The language of the sentences Kin says. */
  readonly say: string;
  /** The language Twilio should expect when it listens. */
  readonly listen: string;
};

export const TWILIO_VOICES: Readonly<Record<OfficeLocale, TwilioVoice>> = {
  en: { voice: "Polly.Joanna", say: "en-US", listen: "en-US" },
  fr: { voice: "Polly.Lea", say: "fr-FR", listen: "fr-FR" },
  de: { voice: "Polly.Vicki", say: "de-DE", listen: "de-DE" },
  it: { voice: "Polly.Bianca", say: "it-IT", listen: "it-IT" },
  es: { voice: "Polly.Lucia", say: "es-ES", listen: "es-ES" },
  ar: { voice: "Polly.Hala-Neural", say: "ar-AE", listen: "ar-AE" },
  he: { voice: null, say: "he-IL", listen: "he-IL" },
};

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>';

function say(locale: OfficeLocale, sentence: string): string {
  const { voice, say: language } = TWILIO_VOICES[locale];
  const voiceAttribute = voice === null ? "" : ` voice="${escapeXml(voice)}"`;
  return `<Say${voiceAttribute} language="${escapeXml(language)}">${escapeXml(sentence)}</Say>`;
}

/**
 * Kin says its sentences and listens for the caller's answer, which Twilio
 * posts to `actionUrl`. `actionOnEmptyResult` makes silence reach Kin too, so
 * a quiet caller is asked again; the redirect is the same turn by another road
 * should Twilio fall through.
 */
export function sayAndListen(locale: OfficeLocale, sentences: readonly string[], actionUrl: string): string {
  const url = escapeXml(actionUrl);
  const gather = `<Gather input="speech" language="${escapeXml(TWILIO_VOICES[locale].listen)}" speechTimeout="auto" timeout="6" method="POST" actionOnEmptyResult="true" action="${url}"/>`;
  return `${XML_HEAD}<Response>${sentences.map((each) => say(locale, each)).join("")}${gather}<Redirect method="POST">${url}</Redirect></Response>`;
}

/** Kin says its last sentences and ends the call. */
export function sayAndHangUp(locale: OfficeLocale, sentences: readonly string[]): string {
  return `${XML_HEAD}<Response>${sentences.map((each) => say(locale, each)).join("")}<Hangup/></Response>`;
}

/** An empty answer, for a request that needs none (a status report). */
export const EMPTY_RESPONSE = `${XML_HEAD}<Response/>`;
