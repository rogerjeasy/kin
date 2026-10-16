import { calendarDay } from "@kin/domain";

/**
 * Rose's month is written once, around one moment: the template's clock, the
 * evening Rose's month is ready to close. A visitor's copy is moved to the
 * moment they press the Demo button, so their demo clock reads today and the
 * story ends now: every instant moves by the same span, every date by the
 * same number of days, and the month's entries count toward the period that
 * is open on the new clock.
 */
export type DemoTime = {
  /** The visitor's demo clock. */
  readonly now: Date;
  /** The settlement period open on that clock, as YYYY-MM. */
  readonly period: string;
  /** A moment of the template, moved. */
  readonly at: (instant: Date) => Date;
  /** A date of the template (YYYY-MM-DD), moved by whole days. */
  readonly day: (date: string) => string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The template's moments moved so that `templateClock` falls on `now`, in `timezone`. */
export function demoTime(templateClock: Date, now: Date, timezone: string): DemoTime {
  const span = now.getTime() - templateClock.getTime();
  const days = Math.round((dayNumber(calendarDay(now, timezone).occurredOn) - dayNumber(calendarDay(templateClock, timezone).occurredOn)) / DAY_MS) * DAY_MS;
  return {
    now,
    period: calendarDay(now, timezone).period,
    at: (instant) => new Date(instant.getTime() + span),
    day: (date) => new Date(dayNumber(date) + days).toISOString().slice(0, 10),
  };
}

// A calendar date as the UTC midnight that starts it, so days add without
// daylight-saving changes in any timezone.
function dayNumber(date: string): number {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(time)) throw new RangeError(`Not a date: ${date}`);
  return time;
}
