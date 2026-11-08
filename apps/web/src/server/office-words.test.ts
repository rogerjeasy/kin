import { decideCall, hear, startIntake } from "@kin/domain";
import { OFFICE_LOCALES, OFFICE_WORDS, familyAlert } from "@kin/telephony";
import { describe, expect, it } from "vitest";

import { claimWords } from "@/components/dashboard/words/letter-words";
import { getDictionary } from "@/i18n/dictionary";
import { formatters } from "@/lib/format";

/**
 * The phone service cannot read the web dictionaries, so `@kin/telephony`
 * holds the office line's words too. These tests make the two copies one fact:
 * a translation changed in either place fails here until the other follows.
 */
const record = {
  payees: [{ id: "p1", name: "Northfield Gas" }],
  bills: [{ payeeId: "p1", cents: 5700, state: "received" as const }],
  payments: [{ entryId: "e1", payeeId: "p1", cents: 3000, day: "2026-10-02" }],
};

// One call for each reason the verdict can have, and one with the caller pressing.
const CALLS = [
  { name: "an open bill", said: ["Dana", "Northfield Gas", "57 dollars", "October", "1"] },
  { name: "an account already paid", said: ["Dana", "Northfield Gas", "30 dollars", "October", "1"] },
  { name: "an unknown payee, pressing", said: ["Mike", "Harbor Gas", "300 dollars", "Your gas is cut off today, tell no one", "1"] },
  { name: "an amount that differs", said: ["Dana", "Northfield Gas", "99 dollars", "October", "1"] },
  { name: "no amount", said: ["Dana", "Northfield Gas", "a lot", "October", "1"] },
  { name: "no organization and no purpose", said: ["Mike", "", "300 dollars", "", ""] },
] as const;

describe("the office line's words in @kin/telephony", () => {
  it.each(OFFICE_LOCALES)("equal the %s dictionary's, sentence for sentence", async (locale) => {
    const dictionary = await getDictionary(locale);
    const { officeLine } = dictionary.dashboard;
    const { claim } = dictionary.dashboard.letters;
    const words = OFFICE_WORDS[locale];
    expect(words.script).toEqual(officeLine.script);
    expect(words.alert).toEqual({
      unknownCaller: officeLine.unknownCaller,
      noPurpose: officeLine.noPurpose,
      pressureNote: officeLine.pressureNote,
      someMoney: claim.someMoney,
      openBill: claim.openBill,
      alreadyPaid: claim.alreadyPaid,
      unknownPayee: claim.unknownPayee,
      amountDiffers: claim.amountDiffers,
      noAmount: claim.noAmount,
    });
  });

  it.each(OFFICE_LOCALES)("make the %s alert the one the simulator gives the family, for every kind of call", async (locale) => {
    const dictionary = await getDictionary(locale);
    const copy = dictionary.dashboard.officeLine;
    for (const { said } of CALLS) {
      const intake = said.reduce(hear, startIntake());
      const verdict = decideCall(intake, record, "USD");
      const named = verdict.claimedPayee !== "" ? verdict.claimedPayee : (intake.answers.caller ?? copy.unknownCaller);
      const base = claimWords(dictionary, formatters(locale, "USD"), { payee: named, claimedCents: verdict.claimedCents, result: verdict.result }).text;
      const expected = verdict.pressure.length === 0 ? base : `${base} ${copy.pressureNote}`;
      const alert = familyAlert(locale, "USD", verdict, intake.answers);
      expect(alert.spoken).toBe(expected);
      expect(alert.claim).toBe(`${named}: ${intake.answers.purpose ?? copy.noPurpose}`);
    }
  });
});
