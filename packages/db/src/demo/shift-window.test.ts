import { calendarDay } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { startOfLocalDay, todaysShiftWindow } from "./shift-window.ts";

const NEW_YORK = "America/New_York";
const at = (iso: string): Date => new Date(iso);

describe("startOfLocalDay", () => {
  it("is the circle's midnight, not UTC's", () => {
    // 01:19 on Monday 9 November in New York (EST, UTC-5) is 06:19 UTC.
    expect(startOfLocalDay(at("2026-11-09T06:19:00Z"), NEW_YORK).toISOString()).toBe("2026-11-09T05:00:00.000Z");
    expect(startOfLocalDay(at("2026-11-09T18:00:00Z"), NEW_YORK).toISOString()).toBe("2026-11-09T05:00:00.000Z");
    expect(startOfLocalDay(at("2026-11-09T04:59:00Z"), NEW_YORK).toISOString()).toBe("2026-11-08T05:00:00.000Z");
  });
});

describe("todaysShiftWindow", () => {
  it("keeps a shift that began earlier today as the template tells it", () => {
    const now = at("2026-11-09T18:00:00Z");
    const window = todaysShiftWindow({ startsAt: at("2026-11-09T14:00:00Z"), endsAt: at("2026-11-09T20:00:00Z") }, now, NEW_YORK);
    expect(window).toEqual({ startsAt: at("2026-11-09T14:00:00Z"), endsAt: at("2026-11-09T20:00:00Z") });
  });

  it("does not begin yesterday when the demo is started in the small hours, so a Monday's week shows it", () => {
    // Template: four hours before the clock, two after. The clock reads 01:19 on Monday in New York.
    const now = at("2026-11-09T06:19:00Z");
    const window = todaysShiftWindow({ startsAt: at("2026-11-09T02:19:00Z"), endsAt: at("2026-11-09T08:19:00Z") }, now, NEW_YORK);
    expect(calendarDay(window.startsAt, NEW_YORK).occurredOn).toBe("2026-11-09");
    expect(window.startsAt.toISOString()).toBe("2026-11-09T05:00:00.000Z");
    expect(window.endsAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("lasts at least an hour past the clock, so there is a visit to check out of", () => {
    const now = at("2026-11-09T06:19:00Z");
    const window = todaysShiftWindow({ startsAt: at("2026-11-09T02:19:00Z"), endsAt: at("2026-11-09T06:30:00Z") }, now, NEW_YORK);
    expect(window.endsAt.getTime() - now.getTime()).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });

  it("is on the clock's own day whatever hour the demo starts at", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const now = new Date(Date.UTC(2026, 10, 9, hour, 19));
      const window = todaysShiftWindow({ startsAt: new Date(now.getTime() - 4 * 60 * 60 * 1000), endsAt: new Date(now.getTime() + 2 * 60 * 60 * 1000) }, now, NEW_YORK);
      expect(calendarDay(window.startsAt, NEW_YORK).occurredOn).toBe(calendarDay(now, NEW_YORK).occurredOn);
    }
  });
});
