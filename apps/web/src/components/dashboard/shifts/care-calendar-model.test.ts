import { describe, expect, it } from "vitest";

import { calendarHeight } from "./care-calendar-options.ts";
import { localeFor } from "./care-calendar-locale.ts";
import {
  eventAccessibleName,
  stackDepths,
  TONE_CLASS,
  toSchedulerEvent,
  visibleHours,
  weekRange,
} from "./care-calendar-model.ts";
import type { CalendarEvent } from "./care-calendar-types.ts";

function shift(overrides: Partial<CalendarEvent> & Pick<CalendarEvent, "startsAt" | "endsAt">): CalendarEvent {
  return { id: "s", resourceId: "m1", title: "Morning care", tone: "neutral", statusText: "Scheduled", ...overrides };
}

describe("the colour of a shift", () => {
  it("has its own class for each tone, so each can be coloured from the tokens", () => {
    expect(TONE_CLASS).toEqual({
      neutral: "care-shift-neutral",
      pending: "care-shift-pending",
      ready: "care-shift-ready",
      paid: "care-shift-paid",
      cancelled: "care-shift-cancelled",
    });
  });
});

describe("the week the calendar opens on", () => {
  it("runs from midnight on the circle's clock, not the browser's", () => {
    const week = weekRange("2026-11-09", "America/New_York");

    expect(week.start.toISOString()).toBe("2026-11-09T05:00:00.000Z");
    expect(week.end.toISOString()).toBe("2026-11-16T05:00:00.000Z");
  });

  it("follows the zone across a change of clocks, so its end is a midnight too", () => {
    // Europe moved its clocks back on 25 October 2026: that week has 169 hours.
    const week = weekRange("2026-10-19", "Europe/Paris");

    expect(week.start.toISOString()).toBe("2026-10-18T22:00:00.000Z");
    expect(week.end.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("refuses a day that is not YYYY-MM-DD", () => {
    expect(() => weekRange("next monday", "Europe/Paris")).toThrow(RangeError);
  });
});

describe("the hours each day shows", () => {
  const week = weekRange("2026-11-09", "Europe/Paris");

  it("are 06:00 to 22:00 when every shift fits", () => {
    const events = [shift({ startsAt: "2026-11-09T08:00:00Z", endsAt: "2026-11-09T12:00:00Z" })];

    expect(visibleHours(events, "Europe/Paris", week)).toEqual({ fromHour: 6, toHour: 22 });
  });

  it("start earlier for a shift before 06:00, in whole ticks", () => {
    const events = [shift({ startsAt: "2026-11-09T03:30:00Z", endsAt: "2026-11-09T07:00:00Z" })];

    // 04:30 in Paris: the day opens at 04:00.
    expect(visibleHours(events, "Europe/Paris", week).fromHour).toBe(4);
  });

  it("end later for a shift after 22:00", () => {
    const events = [shift({ startsAt: "2026-11-09T20:00:00Z", endsAt: "2026-11-09T22:15:00Z" })];

    // 23:15 in Paris: the day closes at 24:00.
    expect(visibleHours(events, "Europe/Paris", week).toHour).toBe(24);
  });

  it("show the whole day for a night shift that crosses midnight", () => {
    const events = [shift({ startsAt: "2026-11-10T21:00:00Z", endsAt: "2026-11-11T05:00:00Z" })];

    expect(visibleHours(events, "Europe/Paris", week)).toEqual({ fromHour: 0, toHour: 24 });
  });

  it("read a shift on the circle's clock, whatever the browser's", () => {
    const events = [shift({ startsAt: "2026-11-09T13:00:00Z", endsAt: "2026-11-09T17:00:00Z" })];

    // 08:00 to 12:00 in New York is inside the default day; 14:00 to 18:00 in Paris too.
    expect(visibleHours(events, "America/New_York", weekRange("2026-11-09", "America/New_York"))).toEqual({ fromHour: 6, toHour: 22 });
    // Seen from Tokyo the same shift runs 22:00 to 02:00 and crosses midnight.
    expect(visibleHours(events, "Asia/Tokyo", weekRange("2026-11-09", "Asia/Tokyo"))).toEqual({ fromHour: 0, toHour: 24 });
  });

  it("ignore a shift outside the week", () => {
    const events = [shift({ startsAt: "2026-11-23T01:00:00Z", endsAt: "2026-11-23T03:00:00Z" })];

    expect(visibleHours(events, "Europe/Paris", week)).toEqual({ fromHour: 6, toHour: 22 });
  });
});

describe("a shift as the scheduler's record", () => {
  it("keeps the instants, names the shift and carries its tone's class", () => {
    const record = toSchedulerEvent(shift({ id: "s9", resourceId: "m2", tone: "paid", startsAt: "2026-11-09T08:00:00Z", endsAt: "2026-11-09T12:00:00Z" }));

    expect(record).toEqual({
      id: "s9",
      resourceId: "m2",
      name: "Morning care",
      startDate: new Date("2026-11-09T08:00:00Z"),
      endDate: new Date("2026-11-09T12:00:00Z"),
      cls: "care-shift-paid",
    });
  });
});

describe("the accessible name of a shift", () => {
  const event = shift({ startsAt: "2026-11-09T08:00:00Z", endsAt: "2026-11-09T12:00:00Z", statusText: "Waiting for Rose's word" });

  it("joins the title, the day and times on the circle's clock, and the status", () => {
    expect(eventAccessibleName(event, "en", "Europe/Paris")).toBe("Morning care, Monday 9:00 AM - 1:00 PM, Waiting for Rose's word");
  });

  it("is worded for the language the app is in", () => {
    expect(eventAccessibleName(event, "fr", "Europe/Paris")).toBe("Morning care, lundi 09:00 - 13:00, Waiting for Rose's word");
  });
});

describe("how tall each person's row must be", () => {
  const people = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];

  it("is one lane for a person with no shifts or no overlap", () => {
    const events = [
      shift({ id: "a", resourceId: "m1", startsAt: "2026-11-09T08:00:00Z", endsAt: "2026-11-09T10:00:00Z" }),
      shift({ id: "b", resourceId: "m1", startsAt: "2026-11-09T10:00:00Z", endsAt: "2026-11-09T12:00:00Z" }),
    ];

    expect(stackDepths(people, events)).toEqual([1, 1, 1]);
  });

  it("counts the most shifts that overlap at once", () => {
    const events = [
      shift({ id: "a", resourceId: "m2", startsAt: "2026-11-09T08:00:00Z", endsAt: "2026-11-09T12:00:00Z" }),
      shift({ id: "b", resourceId: "m2", startsAt: "2026-11-09T09:00:00Z", endsAt: "2026-11-09T13:00:00Z" }),
      shift({ id: "c", resourceId: "m2", startsAt: "2026-11-09T11:00:00Z", endsAt: "2026-11-09T14:00:00Z" }),
    ];

    expect(stackDepths(people, events)).toEqual([1, 3, 1]);
  });

  it("grows the calendar by a lane for each stacked shift, up to its cap", () => {
    expect(calendarHeight([2, 1])).toBeGreaterThan(calendarHeight([1, 1]));
    expect(calendarHeight(Array.from({ length: 30 }, () => 1))).toBe(560);
    // With nobody to show it is just the headers.
    expect(calendarHeight([])).toBeLessThan(calendarHeight([1]));
  });
});

describe("the language of the calendar", () => {
  it("is found from the language part of the tag", () => {
    expect(localeFor("fr-CA").name).toBe("FrFr");
    expect(localeFor("AR").name).toBe("Ar");
    expect(localeFor("he").name).toBe("He");
  });

  it("falls back to English for any other", () => {
    expect(localeFor("ja").name).toBe("En");
  });
});
