import { describe, expect, it } from "vitest";

import { SPEECH_LANGUAGES, isSpeechLocale } from "./languages.ts";

describe("Kin's speaking languages", () => {
  it("hear every one of Kin's seven languages, and speak all but Hebrew, which Polly has no voice for", () => {
    expect(Object.keys(SPEECH_LANGUAGES).toSorted()).toEqual(["ar", "de", "en", "es", "fr", "he", "it"]);
    expect(Object.entries(SPEECH_LANGUAGES).filter(([, language]) => language.voice === null).map(([locale]) => locale)).toEqual(["he"]);
    expect(SPEECH_LANGUAGES.ar).toEqual({ transcribe: "ar-AE", voice: { id: "Hala", languageCode: "ar-AE" } });
  });

  it("recognise only those locales", () => {
    expect(["en", "he", "pt", "", "toString"].map(isSpeechLocale)).toEqual([true, true, false, false, false]);
  });
});
