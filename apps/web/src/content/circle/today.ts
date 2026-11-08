import type { CircleSnapshot } from "@kin/db";

/** The circle's "today" as `YYYY-MM-DD`, on its own clock and in its own timezone. */
export function circleToday(circle: CircleSnapshot): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: circle.circle.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(circle.circle.now);
  const part = (type: "year" | "month" | "day") => parts.find((each) => each.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
