import { describe, expect, it } from "vitest";

import { calendarDay } from "@kin/domain";

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

  it("isolate an amount in right-to-left languages only, so its marks stay beside its digits", () => {
    for (const locale of ["ar", "he"] as const) {
      expect(formatters(locale, "USD").money(30000)).toMatch(/^\u2068.*300[.,]00.*\u2069$/u);
      expect(formatters(locale, "USD").share(5000)).toMatch(/^\u2068.*\u2069$/u);
    }
    expect(formatters("fr", "USD").money(30000)).not.toMatch(/[\u2068\u2069]/u);
  });

  it("show a calendar day without shifting it into the reader's timezone", () => {
    expect(english.day("2026-10-02")).toBe("Oct 2");
    expect(english.day("2026-10-31")).toBe("Oct 31");
    expect(english.month("2026-11")).toBe("November 2026");
  });

  it("write an instant on the circle's own calendar and clock, not UTC's", () => {
    // 02:00 UTC on 8 November is 9:00 PM on 7 November in New York, where the family lives.
    const lateEvening = new Date("2026-11-08T02:00:00Z");
    const newYork = formatters("en", "USD", "America/New_York");

    expect(newYork.longDay(lateEvening)).toBe("Saturday, November 7, 2026");
    expect(newYork.dateTime(lateEvening)).toBe("Nov 7, 9:00 PM EST");
    expect(english.longDay(lateEvening)).toBe("Sunday, November 8, 2026");
    expect(formatters("en", "USD", "Pacific/Auckland").dateTime(lateEvening)).toBe("Nov 8, 3:00 PM GMT+13");
  });

  it("agrees with the calendar day the database records for the same instant", () => {
    const lateEvening = new Date("2026-11-08T02:00:00Z");
    const zone = "America/New_York";
    const recorded = calendarDay(lateEvening, zone).occurredOn;

    expect(formatters("en", "USD", zone).day(recorded)).toBe("Nov 7");
    expect(formatters("en", "USD", zone).longDay(lateEvening)).toContain("November 7");
  });

  it("never shifts a day that is already a date, in any zone", () => {
    expect(formatters("en", "USD", "America/New_York").longCalendarDay("2026-11-08")).toBe("Sunday, November 8, 2026");
    expect(formatters("en", "USD", "Pacific/Auckland").day("2026-11-08")).toBe("Nov 8");
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
