import { describe, expect, it } from "vitest";

import { CHECK_IN_WORDS, CheckInTextError, TEXT_LOCALES, checkInText, type CheckInFacts } from "./check-in-text.ts";

const LINK = "https://kin.example.com/c/check-in/abc123";
// 14:00 in New York in winter is 19:00 UTC.
const FACTS: CheckInFacts = { locale: "en", caregiverName: "Amara", startsAt: new Date("2026-12-01T19:00:00Z"), timezone: "America/New_York", link: LINK };

describe("the check-in text", () => {
  it("says whose message it is, then the name, the time on the circle's clock and the link", () => {
    expect(checkInText(FACTS)).toBe(`Kin, your family’s care app.\nAmara, tap to check in to your shift at 2:00 PM: ${LINK}`);
  });

  it("shows the time on the circle's clock, not the server's", () => {
    expect(checkInText({ ...FACTS, timezone: "Europe/Paris" })).toContain("at 8:00 PM:");
    expect(checkInText({ ...FACTS, timezone: "Asia/Tokyo" })).toContain("at 4:00 AM:");
  });

  it("is written in every language, with the name, a time with Latin digits and the link, and no blank left", () => {
    for (const locale of TEXT_LOCALES) {
      const text = checkInText({ ...FACTS, locale });
      const [disclosure, line] = text.split("\n");
      expect(disclosure, locale).toContain("Kin");
      expect(line, locale).toContain("Amara");
      expect(line, locale).toContain(LINK);
      expect(line, locale).toMatch(/\d{1,2}[:.]00/);
      expect(text, locale).not.toMatch(/[{}]/);
      expect(text, locale).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(text.length, locale).toBeLessThan(300);
    }
  });

  it("isolates the name, time and link from a right-to-left sentence, and only there", () => {
    for (const locale of ["ar", "he"] as const) {
      const line = checkInText({ ...FACTS, locale }).split("\n")[1] ?? "";
      expect(line.match(/⁨/g)?.length, locale).toBe(3);
      expect(line.match(/⁩/g)?.length, locale).toBe(3);
    }
    for (const locale of ["en", "fr", "de", "it", "es"] as const) expect(checkInText({ ...FACTS, locale }), locale).not.toMatch(/[⁦-⁩]/);
  });

  it("starts the first line of a right-to-left text with a right-to-left mark, so its Latin 'Kin' does not flip the whole line", () => {
    for (const locale of ["ar", "he"] as const) expect(checkInText({ ...FACTS, locale }).startsWith("‏Kin"), locale).toBe(true);
    for (const locale of ["en", "fr", "de", "it", "es"] as const) expect(checkInText({ ...FACTS, locale }), locale).not.toContain("‏");
  });

  it("names a link, a name and a time in each template exactly once", () => {
    for (const locale of TEXT_LOCALES) {
      const { line } = CHECK_IN_WORDS[locale];
      for (const key of ["{name}", "{time}", "{url}"]) expect(line.split(key), `${locale} ${key}`).toHaveLength(2);
    }
  });

  it("drops what a name cannot hold, so a name cannot smuggle in a second link", () => {
    const text = checkInText({ ...FACTS, caregiverName: "Amara <b>https://evil.example/x</b>\nPay now" });
    expect(text.split("\n")).toHaveLength(2);
    expect(text).not.toMatch(/[<>]/);
    expect(text.split("https://")).toHaveLength(2); // only the real link: the name lost its colon and slashes
  });

  it("refuses facts that cannot make a message", () => {
    const bad: Partial<CheckInFacts>[] = [
      { caregiverName: " <> " },
      { link: "http://kin.example.com/c" },
      { link: "kin.example.com/c" },
      { link: "https://user:pw@kin.example.com/c" },
      { link: `https://kin.example.com/${"a".repeat(300)}` },
      { link: "https://kin.example.com/a b" },
      { startsAt: new Date("nope") },
      { timezone: "Mars/Olympus" },
    ];
    for (const change of bad) expect(() => checkInText({ ...FACTS, ...change }), JSON.stringify(change).slice(0, 60)).toThrow(CheckInTextError);
  });
});
