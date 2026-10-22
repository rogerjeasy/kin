import { describe, expect, it } from "vitest";

import { demoTime } from "./demo-time.ts";

const TEMPLATE = new Date("2026-10-30T18:00:00Z");
const NEW_YORK = "America/New_York";

describe("demoTime", () => {
  it("changes nothing when pressed at the template's own clock", () => {
    const time = demoTime(TEMPLATE, TEMPLATE, NEW_YORK);
    expect(time.now).toEqual(TEMPLATE);
    expect(time.period).toBe("2026-10");
    expect(time.day("2026-10-01")).toBe("2026-10-01");
    expect(time.at(new Date("2026-10-29T16:10:00Z"))).toEqual(new Date("2026-10-29T16:10:00Z"));
  });

  it("moves every moment by the same span and every date by the same days, so the order of events holds", () => {
    const pressed = new Date("2027-03-02T13:05:00Z");
    const time = demoTime(TEMPLATE, pressed, NEW_YORK);
    expect(time.at(TEMPLATE)).toEqual(pressed);
    expect(time.day("2026-10-30")).toBe("2027-03-02");
    // 123 days later.
    expect(time.day("2026-10-01")).toBe("2027-02-01");
    expect(time.day("2026-11-12")).toBe("2027-03-15");
    expect(time.period).toBe("2027-03");
  });

  it("reads the day of the press in the circle's timezone, not the server's", () => {
    // 02:00 UTC on 1 November is still 31 October in New York.
    const time = demoTime(TEMPLATE, new Date("2026-11-01T02:00:00Z"), NEW_YORK);
    expect(time.day("2026-10-30")).toBe("2026-10-31");
    expect(time.period).toBe("2026-10");
  });

  it("moves dates by whole days across a change of daylight-saving time", () => {
    // New York leaves daylight-saving time on 1 November 2026.
    const time = demoTime(TEMPLATE, new Date("2026-11-20T18:00:00Z"), NEW_YORK);
    expect(time.day("2026-10-30")).toBe("2026-11-20");
    expect(time.day("2026-10-01")).toBe("2026-10-22");
  });

  it("refuses a date it cannot read", () => {
    expect(() => demoTime(TEMPLATE, TEMPLATE, NEW_YORK).day("30/10/2026")).toThrow(RangeError);
  });
});
