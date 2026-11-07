import type { CircleSnapshot } from "@kin/db";

import { nextPeriod, openPeriod } from "./period";
import { upcomingBills, type UpcomingView } from "./upcoming";

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The months a statement can be read for, newest first: every month with an entry, and the open one. */
export function statementPeriods(circle: CircleSnapshot): string[] {
  return [...new Set([openPeriod(circle), ...circle.ledger.entries.map((entry) => entry.period)])].toSorted().toReversed();
}

/** The month asked for, if the circle has one; otherwise the open month. */
export function requestedPeriod(circle: CircleSnapshot, raw: string | undefined): string {
  return raw !== undefined && PERIOD.test(raw) && statementPeriods(circle).includes(raw) ? raw : openPeriod(circle);
}

/**
 * What the family expects next, soonest first. For the open month that is
 * every bill still expected, since none has arrived yet; for an earlier
 * month, the bills that were due in the month after it.
 */
export function expectedAfter(circle: CircleSnapshot, period: string): UpcomingView[] {
  const bills = period === openPeriod(circle) ? upcomingBills(circle) : upcomingBills(circle).filter((bill) => bill.due.startsWith(nextPeriod(period)));
  return bills.toSorted((a, b) => a.due.localeCompare(b.due));
}
