import { describe, expect, it } from "vitest";

import { OFFICE_LOCALES } from "../office-words.ts";
import { SHIFT_CALL_WORDS, ShiftCallWordsError, shiftCallSentences, speakableName } from "./shift-call-words.ts";

const DAY_PARTS = ["morning", "afternoon", "evening"] as const;

describe("the sentences of the shift call", () => {
  it("say, in English, what the owner asked for, filled from the record", () => {
    const sentences = shiftCallSentences({ locale: "en", caregiverName: "Amara", dayPart: "morning", contactName: "Elena" });
    expect(sentences.opening).toEqual([
      "This is Kin, an automated assistant for your family.",
      "If you did not expect this call, you can hang up.",
      "Amara is finishing the visit.",
    ]);
    expect(sentences.question).toBe("Was Amara with you this morning? Say yes, or press 1. Say no, or press 2.");
    expect(sentences.confirmed).toEqual(["Thank you. I have told Amara and the family."]);
    expect(sentences.declined).toEqual(["Thank you for telling me.", "I will leave this for Elena."]);
    expect(sentences.unclear).toEqual(["I did not hear a clear answer.", "I will leave this for Elena."]);
  });

  it("have the same shape in all seven languages, with no blank left unfilled", () => {
    for (const locale of OFFICE_LOCALES) {
      for (const dayPart of DAY_PARTS) {
        for (const contactName of ["Elena", null]) {
          const sentences = shiftCallSentences({ locale, caregiverName: "Amara", dayPart, contactName });
          const everything = [...sentences.opening, sentences.question, sentences.reprompt, ...sentences.confirmed, ...sentences.declined, ...sentences.unclear];
          for (const sentence of everything) {
            expect(sentence, `${locale} ${dayPart}`).not.toMatch(/[{}]/);
            expect(sentence.trim()).not.toBe("");
          }
          expect(sentences.question, locale).toContain("Amara");
          expect(sentences.question, locale).toContain(SHIFT_CALL_WORDS[locale].when[dayPart]);
          expect(sentences.opening.join(" "), locale).toContain("Kin");
        }
      }
    }
  });

  it("offer the two ways to answer in every language: the word and the key", () => {
    for (const locale of OFFICE_LOCALES) {
      const { question } = shiftCallSentences({ locale, caregiverName: "Amara", dayPart: "afternoon", contactName: null });
      expect(question, locale).toMatch(/1/);
      expect(question, locale).toMatch(/2/);
    }
  });

  it("name the family when no contact is known, and the contact when one is", () => {
    for (const locale of OFFICE_LOCALES) {
      const none = shiftCallSentences({ locale, caregiverName: "Amara", dayPart: "morning", contactName: null });
      const some = shiftCallSentences({ locale, caregiverName: "Amara", dayPart: "morning", contactName: "Elena" });
      expect(none.declined.join(" "), locale).not.toContain("Elena");
      expect(some.declined.join(" "), locale).toContain("Elena");
      expect(some.unclear.at(-1), locale).toBe(some.declined.at(-1));
    }
  });

  it("use different words for each part of the day in every language", () => {
    for (const locale of OFFICE_LOCALES) expect(new Set(Object.values(SHIFT_CALL_WORDS[locale].when)).size, locale).toBe(3);
  });

  it("never take a gendered pronoun for the caregiver or say a number that is not on the record", () => {
    const english = JSON.stringify(SHIFT_CALL_WORDS.en);
    expect(english).not.toMatch(/\b(she|he|her|his)\b/i);
    for (const locale of OFFICE_LOCALES) expect(JSON.stringify(SHIFT_CALL_WORDS[locale]).replace(/[12]/g, "")).not.toMatch(/[0-9]/);
  });

  it("refuse a name that is empty once cleaned, because Kin cannot ask about nobody", () => {
    expect(() => shiftCallSentences({ locale: "en", caregiverName: " <>\u0000 ", dayPart: "morning", contactName: null })).toThrow(ShiftCallWordsError);
  });

  it("drops what a name cannot hold, so a name is never a way to say something else", () => {
    expect(speakableName("  Amara\n<Dial>+1555</Dial> ")).toBe("Amara Dial 1555 Dial");
    expect(speakableName("‮Amara‬")).toBe("Amara");
    expect(speakableName("D’Angelo-Smith Jr.")).toBe("D’Angelo-Smith Jr.");
    expect(speakableName("جان")).toBe("جان");
    expect(speakableName("x".repeat(100))).toHaveLength(40);
  });

  it("treats a blank contact as no contact", () => {
    const sentences = shiftCallSentences({ locale: "en", caregiverName: "Amara", dayPart: "evening", contactName: "<>" });
    expect(sentences.declined.at(-1)).toBe("I will leave this for the family.");
  });
});
