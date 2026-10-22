import { ROSES_CIRCLE, demoTime } from "@kin/db";

/**
 * Where Rose's month falls for a visitor who presses the Demo button now:
 * the app moves the template to the press (packages/db/src/demo/demo-time.ts),
 * and the tests read their expected dates from the same function.
 */
export function demoDates(now = new Date()) {
  const time = demoTime(ROSES_CIRCLE.clockAt, now, ROSES_CIRCLE.timezone);
  const [year = "", month = ""] = time.period.split("-");
  return {
    period: time.period,
    /** The period as the screens name it in English, such as "December 2026". */
    monthName: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${year}-${month}-01T12:00:00Z`)),
    day: time.day,
  };
}
