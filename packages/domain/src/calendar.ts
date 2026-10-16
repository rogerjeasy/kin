/**
 * Where an instant falls on a circle's calendar: its date and its settlement
 * period, in the circle's own timezone. The caller passes the instant, so no
 * clock is read here.
 */
export function calendarDay(instant: Date, timezone: string): { readonly occurredOn: string; readonly period: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const part = (type: "year" | "month" | "day") => {
    const value = parts.find((each) => each.type === type)?.value;
    if (value === undefined) throw new RangeError(`No ${type} for ${instant.toISOString()} in ${timezone}`);
    return value;
  };
  const period = `${part("year")}-${part("month")}`;
  return { occurredOn: `${period}-${part("day")}`, period };
}
