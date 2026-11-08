import type { CircleSnapshot } from "@kin/db";
import { calendarDay } from "@kin/domain";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;
/** A week further than this from today is not shown: the address cannot walk the page into the far future. */
const MAX_WEEKS_AWAY = 105;

const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
const dayOf = (number: number): string => new Date(number * DAY_MS).toISOString().slice(0, 10);
const isRealDay = (day: string): boolean => DAY.test(day) && !Number.isNaN(dayNumber(day)) && dayOf(dayNumber(day)) === day;

export type ShiftWeek = {
  /** The Monday, as YYYY-MM-DD on the circle's calendar. */
  readonly start: string;
  /** The Sunday after it. */
  readonly end: string;
  readonly previous: string;
  readonly next: string;
  /** Whether it is the week the circle's clock is in. */
  readonly current: boolean;
};

/** The Monday of the week a calendar day falls in. 1970-01-01 was a Thursday, so day 0 is Thursday. */
function mondayOf(day: string): string {
  const number = dayNumber(day);
  return dayOf(number - ((number + 3) % WEEK_DAYS));
}

/**
 * The week the shifts screen shows: the one in `?week=`, read as any day of
 * it, or the circle's own current week when that is missing, malformed, a day
 * that does not exist or too far away. Weeks run Monday to Sunday on the
 * circle's calendar, so the calendar and the list always show the same days.
 */
export function shiftWeek(circle: CircleSnapshot, requested: string | undefined): ShiftWeek {
  const today = calendarDay(circle.circle.now, circle.circle.timezone).occurredOn;
  const currentStart = mondayOf(today);
  const asked = requested !== undefined && isRealDay(requested) ? mondayOf(requested) : currentStart;
  const start = Math.abs(dayNumber(asked) - dayNumber(currentStart)) / WEEK_DAYS > MAX_WEEKS_AWAY ? currentStart : asked;
  const first = dayNumber(start);
  return { start, end: dayOf(first + WEEK_DAYS - 1), previous: dayOf(first - WEEK_DAYS), next: dayOf(first + WEEK_DAYS), current: start === currentStart };
}
