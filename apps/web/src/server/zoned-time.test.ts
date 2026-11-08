import { describe, expect, it } from "vitest";

import { zonedInstant } from "./zoned-time";

describe("the instant a wall clock reads in the circle's zone", () => {
  it("applies the zone's own offset, winter and summer", () => {
    expect(zonedInstant("2026-11-02", "09:00", "America/New_York")?.toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(zonedInstant("2026-07-02", "09:00", "America/New_York")?.toISOString()).toBe("2026-07-02T13:00:00.000Z");
    expect(zonedInstant("2026-11-02", "09:00", "Asia/Kolkata")?.toISOString()).toBe("2026-11-02T03:30:00.000Z");
  });

  it("reads the day on either side of a clock change correctly", () => {
    // New York fell back on 1 November 2026: 01:30 happens twice, and 09:00 that morning is already winter time.
    expect(zonedInstant("2026-11-01", "09:00", "America/New_York")?.toISOString()).toBe("2026-11-01T14:00:00.000Z");
    expect(zonedInstant("2026-03-08", "09:00", "America/New_York")?.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  it("refuses a time the clock skipped, and anything not written as a day and a time", () => {
    expect(zonedInstant("2026-03-08", "02:30", "America/New_York")).toBeNull();
    for (const [day, time] of [["2026-13-01", "09:00"], ["2026-02-30", "09:00"], ["2026-11-02", "24:00"], ["2026-11-02", "9:00"], ["", ""], ["2026-11-02T00:00", "09:00"]]) {
      expect(zonedInstant(day ?? "", time ?? "", "UTC")).toBeNull();
    }
  });
});
