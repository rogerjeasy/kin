import { formatMoney } from "@kin/domain";

import { numberLocaleOf, type Locale } from "@/i18n/locales";

const HOUR_MS = 60 * 60 * 1000;

// Dates in the record are calendar days, so they are read and shown in UTC and
// never shift by a day in the reader's timezone.
function calendarDay(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00Z`);
}

/**
 * Every way the dashboard writes a number, a date or a list, in the reader's
 * language. Money goes through the one shared formatter in the money core.
 */
export function formatters(locale: Locale, currency: string) {
  const intlLocale = numberLocaleOf(locale);
  const shortDay = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", timeZone: "UTC" });
  const dayWithYear = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const longDay = new Intl.DateTimeFormat(intlLocale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const month = new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric", timeZone: "UTC" });
  const dayAndTime = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  const relative = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" });
  const list = new Intl.ListFormat(intlLocale, { style: "long", type: "disjunction" });
  const allOf = new Intl.ListFormat(intlLocale, { style: "long", type: "conjunction" });
  const percent = new Intl.NumberFormat(intlLocale, { style: "percent", maximumFractionDigits: 1 });
  const count = new Intl.NumberFormat(intlLocale);

  return {
    money: (cents: number) => formatMoney({ cents, currency }, intlLocale),
    day: (isoDay: string) => shortDay.format(calendarDay(isoDay)),
    /** "Oct 9, 2026": for spans that can cross a year, where the short form is ambiguous. */
    dayWithYear: (isoDay: string) => dayWithYear.format(calendarDay(isoDay)),
    longDay: (date: Date) => longDay.format(date),
    month: (period: string) => month.format(calendarDay(`${period}-01`)),
    dateTime: (date: Date) => dayAndTime.format(date),
    /** "in 47 hours", from now until `then`. */
    hoursUntil: (then: Date, now: Date) => relative.format(Math.round((then.getTime() - now.getTime()) / HOUR_MS), "hour"),
    /** "Elena, Marcus or Ana". */
    anyOf: (items: readonly string[]) => list.format(items),
    /** "Elena and Marcus". */
    allOf: (items: readonly string[]) => allOf.format(items),
    /** A share in basis points, as a percentage. */
    share: (bps: number) => percent.format(bps / 10_000),
    count: (value: number) => count.format(value),
  };
}

export type Formatters = ReturnType<typeof formatters>;
