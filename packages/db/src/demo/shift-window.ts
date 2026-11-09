const HOUR_MS = 60 * 60 * 1000;

/** The start of the circle's calendar day that contains `instant`, as an instant. */
export function startOfLocalDay(instant: Date, timezone: string): Date {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(instant);
  const part = (type: "hour" | "minute" | "second"): number => {
    const value = parts.find((each) => each.type === type)?.value;
    if (value === undefined) throw new RangeError(`No ${type} for ${instant.toISOString()} in ${timezone}`);
    return Number(value);
  };
  const sinceMidnightMs = ((part("hour") * 60 + part("minute")) * 60 + part("second")) * 1000 + instant.getUTCMilliseconds();
  return new Date(instant.getTime() - sinceMidnightMs);
}

/**
 * Today's shift as the demo tells it. The template has it begin four hours
 * before the demo clock, which in the small hours is yesterday evening: on a
 * Monday that is the week before, and the week the visitor opens shows
 * nothing. So it never begins on an earlier day than the clock's, and it
 * lasts at least an hour past the clock so there is something to check out of.
 */
export function todaysShiftWindow(mapped: { readonly startsAt: Date; readonly endsAt: Date }, now: Date, timezone: string): { readonly startsAt: Date; readonly endsAt: Date } {
  const startsAt = new Date(Math.max(mapped.startsAt.getTime(), startOfLocalDay(now, timezone).getTime()));
  const endsAt = new Date(Math.max(mapped.endsAt.getTime(), now.getTime() + HOUR_MS));
  return { startsAt, endsAt };
}
