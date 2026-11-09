import { PRESENCE_REPLIES, formatMoney } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { OFFICE_LOCALES } from "./office-words.ts";
import { cleanAccount, planPresenceCheck } from "./plan-presence-check.ts";
import { FAMILY_CODE_WORDS, familyCode, isoWeek, matchesFamilyCode } from "./family-code.ts";
import { PRESENCE_CALL_LINES, PRESENCE_WORDS, presenceAlertTexts, presenceAskPreview, presenceAskText, presenceCallText, presenceHelpNote, presenceName, presenceReplyText, voiceConfirmText } from "./presence-words.ts";

const facts = (locale: (typeof OFFICE_LOCALES)[number], claimedCents: number | null = 200_000) => ({ locale, currency: "USD", name: "Theo Okafor", parentName: "Rose Okafor", claimedCents });

describe.each(OFFICE_LOCALES)("the words of 'is it really you?' in %s", (locale) => {
  it("fills every reply for the parent, and none of them holds a digit: no amount is ever said to her", () => {
    for (const reply of PRESENCE_REPLIES) {
      const text = presenceReplyText(facts(locale), reply);
      // Every sentence names the person asked, except the one for a caller nobody on the list is.
      if (reply !== "unknown_person" && reply !== "code_ok" && reply !== "code_wrong") expect(text).toContain("Theo");
      expect(text).not.toMatch(/[{}\d]/);
      expect(text.length).toBeGreaterThan(20);
    }
  });

  it("fills the family's four alerts with the amount from the record, and with a plain word when no amount was named", () => {
    const alerts = presenceAlertTexts(facts(locale));
    for (const alert of Object.values(alerts)) {
      expect(alert).toContain(formatMoney({ cents: 200_000, currency: "USD" }, `${locale}-u-nu-latn`));
      expect(alert).toContain("Rose");
      expect(alert).not.toMatch(/[{}]/);
      expect(alert.length).toBeLessThanOrEqual(600);
    }
    for (const alert of Object.values(presenceAlertTexts(facts(locale, null)))) expect(alert).toContain(PRESENCE_WORDS[locale].alert.someMoney);
  });

  it("fills every sentence of Kin's call to the real person, says the amount to them, and fills the family's help note with a name only", () => {
    for (const line of PRESENCE_CALL_LINES) {
      const text = presenceCallText(facts(locale), line);
      expect(text).not.toMatch(/[{}]/);
      // Only the sentences that send the person on to the parent name her.
      if (line !== "thanksYes") expect(text).toContain("Rose");
    }
    expect(presenceCallText(facts(locale), "question")).toContain(formatMoney({ cents: 200_000, currency: "USD" }, `${locale}-u-nu-latn`));
    for (const line of ["reprompt", "thanksYes", "thanksNo", "unclear"] as const) expect(presenceCallText(facts(locale), line)).not.toMatch(/2[.,\u00a0\u202f]?000/);
    const note = presenceHelpNote({ locale, name: "Theo Okafor" });
    expect(note).toContain("Theo");
    expect(note).not.toMatch(/[{}\d]/);
    expect(note.length).toBeLessThanOrEqual(300);
    expect(PRESENCE_WORDS[locale].line.askCode.length).toBeGreaterThan(20);
  });

  it("writes the text to the real person in two lines, with the link last and the sender first", () => {
    const text = presenceAskText({ ...facts(locale), link: "https://kin.example.com/en/v/abc" });
    const [sender, line] = text.split("\n");
    expect(sender).toContain("Kin");
    expect(line).toContain("https://kin.example.com/en/v/abc");
    expect(voiceConfirmText({ locale, parentName: "Rose Okafor", link: "https://kin.example.com/en/t/abc" }).split("\n")).toHaveLength(2);
  });
});

describe("the texts' links", () => {
  it("refuses anything but a plain HTTPS address for a real text, and allows a local one only for the demo preview", () => {
    for (const link of ["http://kin.example.com/v/x", "https://user:pw@kin.example.com/v/x", "not a link", "https://kin.example.com/v/x y"]) {
      expect(() => presenceAskText({ ...facts("en"), link })).toThrow();
    }
    expect(presenceAskPreview({ ...facts("en"), link: "http://localhost:3000/en/v/x" })).toContain("http://localhost:3000/en/v/x");
    expect(() => presenceAskPreview({ ...facts("en"), link: "javascript:alert(1)" })).toThrow();
  });

  it("says a first name only, stripped of anything a message should not carry", () => {
    expect(presenceName("  Theo   Okafor ")).toBe("Theo");
    expect(presenceName("<b>Theo</b>")).toBe("b");
  });
});

describe("planning a check from what the parent said", () => {
  const voices = [{ id: "v-theo", name: "Theo Okafor", relationship: "grandson" }];
  const input = { voices, locale: "en", currency: "USD", parentName: "Rose" } as const;

  it("matches, scores and words everything by rules alone, with no model", async () => {
    const plan = await planPresenceCheck({ ...input, said: ["It's Theo, I need $2,000 today, don't tell Mum, buy gift cards"] });
    expect(plan).toMatchObject({ voiceId: "v-theo", voiceName: "Theo Okafor", claimedCents: 200_000, byModel: false });
    expect(plan?.markers).toEqual(["secrecy", "urgency", "gift_cards"]);
    expect(plan?.alerts.denied).toContain("$2,000.00");
  });

  it("uses a model's fields to fill what the rules missed, but never against a trusted name the rules found, and survives a model that fails", async () => {
    const helped = await planPresenceCheck({ ...input, said: ["Your grandson says he needs five hundred dollars"], readAccount: () => Promise.resolve({ claimedName: null, claimedRelationship: "grandson", amountText: "five hundred dollars" }) });
    expect(helped).toMatchObject({ voiceId: "v-theo", claimedCents: 50_000, byModel: true });
    const overruled = await planPresenceCheck({ ...input, said: ["It's Theo, 20 dollars"], readAccount: () => Promise.resolve({ claimedName: "Santa", claimedRelationship: null, amountText: null }) });
    expect(overruled).toMatchObject({ voiceId: "v-theo", claimedName: "Theo Okafor" });
    const failed = await planPresenceCheck({ ...input, said: ["It's Theo, 20 dollars"], readAccount: () => Promise.reject(new Error("down")) });
    expect(failed).toMatchObject({ voiceId: "v-theo", claimedCents: 2_000, byModel: false });
  });

  it("finds a trusted person by another spelling of the name, in another script, as the family wrote it", async () => {
    const aliased = [{ id: "v-theo", name: "Theo Okafor", relationship: "grandson", aliases: ["תיאו", "ثيو"] }];
    const hebrew = await planPresenceCheck({ ...input, voices: aliased, locale: "he", said: ["סבתא, זה תיאו, אני צריך 500 דולר היום"] });
    expect(hebrew).toMatchObject({ voiceId: "v-theo", claimedCents: 50_000 });
    const arabic = await planPresenceCheck({ ...input, voices: aliased, locale: "ar", said: ["جدتي، أنا ثيو، أحتاج 500 دولار اليوم"] });
    expect(arabic).toMatchObject({ voiceId: "v-theo", claimedCents: 50_000 });
    const nobody = await planPresenceCheck({ ...input, voices: [{ ...aliased[0], aliases: [] }] as never, locale: "he", said: ["סבתא, זה תיאו, אני צריך 500 דולר היום"] });
    expect(nobody?.voiceId).toBeNull();
  });

  it("plans nothing for silence, and bounds what it keeps", () => {
    expect(cleanAccount(["", "  "])).toBeNull();
    expect(cleanAccount(Array.from({ length: 30 }, () => "word"))).toHaveLength(12);
    expect((cleanAccount(["x".repeat(5_000)]) ?? [""])[0]?.length).toBeLessThanOrEqual(1_200);
  });
});

describe("the weekly family code", () => {
  const SEED = "ab".repeat(32);

  it("is made of words that are plain, distinct and enough to make a guess hopeless", () => {
    expect(new Set(FAMILY_CODE_WORDS).size).toBe(FAMILY_CODE_WORDS.length);
    expect(FAMILY_CODE_WORDS.length).toBeGreaterThanOrEqual(256);
    for (const word of FAMILY_CODE_WORDS) expect(word).toMatch(/^[a-z]{3,10}$/);
  });

  it("is the same for a circle all week and different the next, from its seed and its own day alone", () => {
    const monday = familyCode(SEED, "2026-11-09");
    expect(monday.week).toBe("2026-W46");
    for (const day of ["2026-11-10", "2026-11-12", "2026-11-15"]) expect(familyCode(SEED, day)).toEqual(monday);
    expect(familyCode(SEED, "2026-11-16").words).not.toEqual(monday.words);
    expect(familyCode("cd".repeat(32), "2026-11-09").words).not.toEqual(monday.words);
    expect(new Set(monday.words).size).toBe(3);
  });

  it("never repeats a word within a code, whatever the seed", () => {
    for (let at = 0; at < 300; at += 1) expect(new Set(familyCode(at.toString(16).padStart(64, "0"), "2026-03-02").words).size).toBe(3);
  });

  it("numbers weeks the ISO way across a year's end", () => {
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
    expect(isoWeek("2025-12-29")).toBe("2026-W01");
    expect(isoWeek("2027-01-03")).toBe("2026-W53");
    expect(isoWeek("2026-11-08")).toBe("2026-W45");
    expect(isoWeek("2026-11-09")).toBe("2026-W46");
  });

  it("matches what the parent heard when all three words are in it, in any order, in any case, and not otherwise", () => {
    const code = familyCode(SEED, "2026-11-09");
    const [a, b, c] = code.words;
    expect(matchesFamilyCode(`${a} ${b} ${c}`, code)).toBe(true);
    expect(matchesFamilyCode(`He said ${c.toUpperCase()}, then ${a}, and ${b}!`, code)).toBe(true);
    expect(matchesFamilyCode(`${a} ${b}`, code)).toBe(false);
    expect(matchesFamilyCode(`${a}${b}${c}`, code)).toBe(false);
    expect(matchesFamilyCode("", code)).toBe(false);
    expect(matchesFamilyCode("apple apple apple", { ...code, words: ["pear", "plum", "fig"] })).toBe(false);
  });

  it("is not passed by reading the list out: another code word beside the three, or a long answer, never matches", () => {
    const code = familyCode(SEED, "2026-11-09");
    const other = FAMILY_CODE_WORDS.find((word) => !code.words.includes(word)) ?? "";
    expect(matchesFamilyCode(`${code.words.join(" ")} ${other}`, code)).toBe(false);
    expect(matchesFamilyCode(FAMILY_CODE_WORDS.join(" "), code)).toBe(false);
    expect(matchesFamilyCode(`${code.words.join(" ")} ${"and so on ".repeat(10)}`, code)).toBe(false);
    expect(matchesFamilyCode(`he said ${code.words.join(", ")} and then hung up`, code)).toBe(true);
  });
});
