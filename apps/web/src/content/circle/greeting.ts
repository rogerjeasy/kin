export type PartOfDay = "morning" | "afternoon" | "evening";

/**
 * Which greeting fits an instant on the circle's own clock: morning from 4 to
 * noon, afternoon until 6 pm, evening otherwise. The circle's time zone, not
 * the server's or the reader's, so "Good morning" means morning where the
 * family lives.
 */
export function partOfDay(now: Date, timeZone: string): PartOfDay {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
  if (hour >= 4 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}
