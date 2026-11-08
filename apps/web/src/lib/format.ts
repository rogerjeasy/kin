import { formatMoney } from "@kin/domain";

import { directionOf, numberLocaleOf, type Locale } from "@/i18n/locales";

const HOUR_MS = 60 * 60 * 1000;

// Dates in the record are calendar days, so they are read and shown in UTC and
// never shift by a day in the reader's timezone.
function calendarDay(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00Z`);
}

const FIRST_STRONG_ISOLATE = "\u2068";
const POP_DIRECTIONAL_ISOLATE = "\u2069";

/**
 * An amount or a percentage is made of digits and neutral marks ("US$", ".",
 * "%"). Set inside a right-to-left sentence the marks drift to the wrong side
 * of the digits (".$US 300.00"), so in those languages each is isolated and
 * reads as one unit. Left-to-right text is left exactly as written.
 */
export function isolatedFor(locale: Locale): (text: string) => string {
  return directionOf(locale) === "rtl" ? (text) => `${FIRST_STRONG_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}` : (text) => text;
}

/**
 * Every way the dashboard writes a number, a date or a list, in the reader's
 * language. Money goes through the one shared formatter in the money core.
 *
 * `timeZone` is the circle's: an instant ("Nov 6, 9:23 PM", "Sunday, November
 * 8") is written on the calendar and clock of the place the family lives in,
 * so it agrees with the calendar days the database records in that zone. A
 * calendar day that is already a date, such as a due date, is never shifted.
 */
export function formatters(locale: Locale, currency: string, timeZone = "UTC") {
  const intlLocale = numberLocaleOf(locale);
  const shortDay = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", timeZone: "UTC" });
  const dayWithYear = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const longDay = new Intl.DateTimeFormat(intlLocale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone });
  const longCalendarDay = new Intl.DateTimeFormat(intlLocale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const month = new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric", timeZone: "UTC" });
  const dayAndTime = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone });
  const clock = new Intl.DateTimeFormat(intlLocale, { hour: "numeric", minute: "2-digit", timeZone });
  const weekdayDay = new Intl.DateTimeFormat(intlLocale, { weekday: "long", day: "numeric", month: "long", timeZone });
  const dayRange = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const relative = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" });
  const list = new Intl.ListFormat(intlLocale, { style: "long", type: "disjunction" });
  const allOf = new Intl.ListFormat(intlLocale, { style: "long", type: "conjunction" });
  const percent = new Intl.NumberFormat(intlLocale, { style: "percent", maximumFractionDigits: 1 });
  const count = new Intl.NumberFormat(intlLocale);
  const isolated = isolatedFor(locale);

  return {
    money: (cents: number) => isolated(formatMoney({ cents, currency }, intlLocale)),
    day: (isoDay: string) => shortDay.format(calendarDay(isoDay)),
    /** "Oct 9, 2026": for spans that can cross a year, where the short form is ambiguous. */
    dayWithYear: (isoDay: string) => dayWithYear.format(calendarDay(isoDay)),
    /** "Sunday, November 8, 2026": the day an instant falls on in the circle's time zone. */
    longDay: (date: Date) => longDay.format(date),
    /** The same, for a day already written as YYYY-MM-DD. */
    longCalendarDay: (isoDay: string) => longCalendarDay.format(calendarDay(isoDay)),
    /** "9:00 AM": the time of day an instant has on the circle's clock. */
    time: (date: Date) => clock.format(date),
    /** "Friday, 30 October": the day an instant falls on in the circle's time zone, without the year. */
    weekdayDay: (date: Date) => weekdayDay.format(date),
    /** "Oct 26 – Nov 1, 2026", from two calendar days already written as YYYY-MM-DD. */
    dayRange: (firstDay: string, lastDay: string) => dayRange.formatRange(calendarDay(firstDay), calendarDay(lastDay)),
    month: (period: string) => month.format(calendarDay(`${period}-01`)),
    dateTime: (date: Date) => dayAndTime.format(date),
    /** "in 47 hours", from now until `then`. */
    hoursUntil: (then: Date, now: Date) => relative.format(Math.round((then.getTime() - now.getTime()) / HOUR_MS), "hour"),
    /** "Elena, Marcus or Ana". */
    anyOf: (items: readonly string[]) => list.format(items),
    /** "Elena and Marcus". */
    allOf: (items: readonly string[]) => allOf.format(items),
    /** A share in basis points, as a percentage. */
    share: (bps: number) => isolated(percent.format(bps / 10_000)),
    count: (value: number) => count.format(value),
  };
}

export type Formatters = ReturnType<typeof formatters>;
