import { describe, expect, it } from "vitest";

import { calendarDay } from "./calendar.ts";

describe("calendarDay", () => {
  it("dates an instant in the circle's own timezone, not the server's", () => {
    const instant = new Date("2026-11-01T03:30:00Z");
    expect(calendarDay(instant, "America/Chicago")).toEqual({ occurredOn: "2026-10-31", period: "2026-10" });
    expect(calendarDay(instant, "Europe/Berlin")).toEqual({ occurredOn: "2026-11-01", period: "2026-11" });
  });

  it("puts the last minute of a year in that year", () => {
    expect(calendarDay(new Date("2027-01-01T04:59:00Z"), "America/New_York")).toEqual({ occurredOn: "2026-12-31", period: "2026-12" });
  });

  it("refuses a timezone that does not exist", () => {
    expect(() => calendarDay(new Date(), "Mars/Olympus")).toThrow(RangeError);
  });
});
