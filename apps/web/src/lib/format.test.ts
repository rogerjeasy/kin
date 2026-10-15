import { describe, expect, it } from "vitest";

import { formatters } from "./format";

const english = formatters("en", "USD");

describe("the dashboard's formatters", () => {
  it("write money through the money core's one formatter, from whole cents", () => {
    expect(english.money(38218)).toBe("$382.18");
    expect(english.money(5)).toBe("$0.05");
    expect(english.money(-16600)).toBe("-$166.00");
  });

  it("use Western digits in every language, so amounts match the copy around them", () => {
    for (const locale of ["ar", "he", "fr", "de"] as const) {
      expect(formatters(locale, "USD").money(38218)).toMatch(/382[.,]18/);
    }
  });

  it("show a calendar day without shifting it into the reader's timezone", () => {
    expect(english.day("2026-10-02")).toBe("Oct 2");
    expect(english.day("2026-10-31")).toBe("Oct 31");
    expect(english.month("2026-11")).toBe("November 2026");
  });

  it("say how long until a moment, in whole hours", () => {
    const now = new Date("2026-10-30T18:00:00Z");

    expect(english.hoursUntil(new Date("2026-11-01T15:00:00Z"), now)).toBe("in 45 hours");
  });

  it("join names as the language does, with 'or' and with 'and'", () => {
    expect(english.anyOf(["Elena", "Marcus", "Ana"])).toBe("Elena, Marcus, or Ana");
    expect(english.allOf(["Elena", "Marcus"])).toBe("Elena and Marcus");
    expect(formatters("fr", "USD").anyOf(["Elena", "Marcus"])).toBe("Elena ou Marcus");
  });

  it("write a share in basis points as a percentage", () => {
    expect(english.share(5000)).toBe("50%");
    expect(english.share(3333)).toBe("33.3%");
  });
});
