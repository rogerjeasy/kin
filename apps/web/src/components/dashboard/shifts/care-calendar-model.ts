import type { CalendarEvent } from "./care-calendar-types.ts";

/** The day a care shift is drawn on: 06:00 to 22:00 unless a shift reaches outside it. */
const DEFAULT_FROM_HOUR = 6;
const DEFAULT_TO_HOUR = 22;
const DAYS_IN_WEEK = 7;
/** Hours between ticks. The shown hours are whole ticks, or the scheduler rounds the day inward and clips a shift. */
export const TICK_HOURS = 2;

export const TONE_CLASS: Record<CalendarEvent["tone"], string> = {
  neutral: "care-shift-neutral",
  pending: "care-shift-pending",
  ready: "care-shift-ready",
  paid: "care-shift-paid",
  cancelled: "care-shift-cancelled",
};

/** A second signal beside the colour, drawn with Bryntum's bundled icon font. */
export const TONE_ICON: Record<CalendarEvent["tone"], string> = {
  neutral: "fa-calendar-day",
  pending: "fa-hourglass-half",
  ready: "fa-key",
  paid: "fa-circle-check",
  cancelled: "fa-ban",
};

export type WeekRange = { readonly start: Date; readonly end: Date };

type Parts = { readonly day: string; readonly hour: number; readonly asUtc: number };

/** An instant's wall clock in a time zone: its calendar day, its hour as a fraction, and that clock read as if it were UTC. */
function wallClock(instant: Date, timezone: string): Parts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const [year, month, day, hour, minute, second] = ["year", "month", "day", "hour", "minute", "second"].map(part) as [number, number, number, number, number, number];
  return {
    day: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    hour: hour + minute / 60,
    asUtc: Date.UTC(year, month - 1, day, hour, minute, second),
  };
}

/** The instant a time zone's clock reads midnight at the start of a YYYY-MM-DD. */
function midnightIn(day: string, timezone: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) throw new RangeError(`A day must be YYYY-MM-DD, got "${day}"`);
  const wanted = Date.UTC(year, month - 1, date);
  // Two passes settle the offset, including across a change of clocks.
  let guess = wanted;
  for (let pass = 0; pass < 2; pass += 1) guess += wanted - wallClock(new Date(guess), timezone).asUtc;
  return new Date(guess);
}

/**
 * The seven days from a YYYY-MM-DD, as the instants their midnights fall at in
 * the circle's time zone. The scheduler shows them on that zone's clock.
 */
export function weekRange(weekStart: string, timezone: string): WeekRange {
  const [year, month, day] = weekStart.split("-").map(Number);
  const end = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + DAYS_IN_WEEK)).toISOString().slice(0, 10);
  return { start: midnightIn(weekStart, timezone), end: midnightIn(end, timezone) };
}

export type HourRange = { readonly fromHour: number; readonly toHour: number };

/**
 * The hours each day shows. A shift outside 06:00 to 22:00 widens the day to
 * hold it, and one that runs past midnight shows the whole day, so no shift is
 * ever cut off.
 */
export function visibleHours(events: readonly CalendarEvent[], timezone: string, range: WeekRange): HourRange {
  let fromHour = DEFAULT_FROM_HOUR;
  let toHour = DEFAULT_TO_HOUR;
  for (const event of events) {
    const starts = new Date(event.startsAt);
    const ends = new Date(event.endsAt);
    if (ends <= range.start || starts >= range.end) continue;
    const from = wallClock(starts, timezone);
    const to = wallClock(ends, timezone);
    const endsAtMidnight = to.hour === 0 && ends > starts;
    if (from.day !== to.day && !endsAtMidnight) return { fromHour: 0, toHour: 24 };
    fromHour = Math.min(fromHour, Math.floor(from.hour / TICK_HOURS) * TICK_HOURS);
    toHour = Math.max(toHour, endsAtMidnight ? 24 : Math.ceil(to.hour / TICK_HOURS) * TICK_HOURS);
  }
  return { fromHour, toHour };
}

export type SchedulerEvent = {
  readonly id: string;
  readonly resourceId: string;
  readonly name: string;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly cls: string;
};

/** One shift as the scheduler's data. The instants stay instants: the scheduler's time zone shows them. */
export function toSchedulerEvent(event: CalendarEvent): SchedulerEvent {
  return {
    id: event.id,
    resourceId: event.resourceId,
    name: event.title,
    startDate: new Date(event.startsAt),
    endDate: new Date(event.endsAt),
    cls: TONE_CLASS[event.tone],
  };
}

/** The name a screen reader reads for a shift: what it is, when, and where it stands. */
export function eventAccessibleName(
  event: { readonly title: string; readonly statusText: string; readonly startsAt: string; readonly endsAt: string },
  locale: string,
  timezone: string,
): string {
  const format = new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "long", hour: "numeric", minute: "2-digit" });
  const time = new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  const end = time.format(new Date(event.endsAt));
  return `${event.title}, ${format.format(new Date(event.startsAt))} - ${end}, ${event.statusText}`;
}

/** How many shifts overlap at the busiest moment, per person: the lanes a row needs. One lane for a person with no shifts. */
export function stackDepths(resources: readonly { readonly id: string }[], events: readonly CalendarEvent[]): number[] {
  return resources.map(({ id }) => {
    const moments = events
      .filter((event) => event.resourceId === id)
      .flatMap((event) => [
        { at: new Date(event.startsAt).getTime(), change: 1 },
        { at: new Date(event.endsAt).getTime(), change: -1 },
      ])
      // An end sorts before a start at the same instant: shifts that touch do not overlap.
      .sort((a, b) => a.at - b.at || a.change - b.change);
    let open = 0;
    let deepest = 1;
    for (const moment of moments) {
      open += moment.change;
      deepest = Math.max(deepest, open);
    }
    return deepest;
  });
}
