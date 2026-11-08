const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

type Wall = { year: number; month: number; day: number; hour: number; minute: number };

function wallClock(instant: number, timeZone: string): Wall {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((each) => each.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute") };
}

const asUtc = (wall: Wall): number => Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);

/**
 * The instant a wall clock reads in a time zone: "2026-11-02" and "09:00" in
 * New York. The circle's calendar, not the browser's offset, decides it, so a
 * form filled in anywhere schedules the same shift. `null` when the day or time
 * is not written as asked, or when the clock never showed that time (the hour a
 * spring change skips).
 */
export function zonedInstant(day: string, time: string, timeZone: string): Date | null {
  const dayParts = DAY.exec(day);
  const timeParts = TIME.exec(time);
  if (dayParts === null || timeParts === null) return null;
  const wanted: Wall = { year: Number(dayParts[1]), month: Number(dayParts[2]), day: Number(dayParts[3]), hour: Number(timeParts[1]), minute: Number(timeParts[2]) };
  const asIfUtc = asUtc(wanted);
  // The offset at the wanted moment is found from the guess, then checked at the result, since the two sides of a change differ.
  let instant = asIfUtc - (asUtc(wallClock(asIfUtc, timeZone)) - asIfUtc);
  instant = asIfUtc - (asUtc(wallClock(instant, timeZone)) - instant);
  // A wall clock that reads back as asked is a real day and a time the zone showed.
  const read = wallClock(instant, timeZone);
  return (Object.keys(wanted) as (keyof Wall)[]).every((key) => read[key] === wanted[key]) ? new Date(instant) : null;
}
