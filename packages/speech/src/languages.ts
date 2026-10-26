import type { SpeechLocale } from "./speech.ts";

/**
 * Each of Kin's languages, as Amazon Transcribe streaming and Amazon Polly
 * name them (checked against both services' documentation on 26 October
 * 2026). Polly has no Hebrew voice, so Hebrew is heard but not spoken.
 */
export const SPEECH_LANGUAGES: Readonly<Record<SpeechLocale, { readonly transcribe: string; readonly voice: { readonly id: string; readonly languageCode: string } | null }>> = {
  en: { transcribe: "en-US", voice: { id: "Danielle", languageCode: "en-US" } },
  fr: { transcribe: "fr-FR", voice: { id: "Lea", languageCode: "fr-FR" } },
  de: { transcribe: "de-DE", voice: { id: "Vicki", languageCode: "de-DE" } },
  es: { transcribe: "es-ES", voice: { id: "Lucia", languageCode: "es-ES" } },
  it: { transcribe: "it-IT", voice: { id: "Bianca", languageCode: "it-IT" } },
  ar: { transcribe: "ar-AE", voice: { id: "Hala", languageCode: "ar-AE" } },
  he: { transcribe: "he-IL", voice: null },
};

export function isSpeechLocale(value: string): value is SpeechLocale {
  return Object.hasOwn(SPEECH_LANGUAGES, value);
}
