import type { CircleSnapshot } from "@kin/db";

/** The settlement period that is open on the circle's clock, as YYYY-MM, in its timezone. */
export function openPeriod(circle: CircleSnapshot): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: circle.circle.timezone, year: "numeric", month: "2-digit" }).formatToParts(circle.circle.now);
  const part = (type: "year" | "month") => parts.find((each) => each.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}`;
}

/** The period after `period`, as YYYY-MM. */
export function nextPeriod(period: string): string {
  const [year = 0, month = 0] = period.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}
