import type { CircleSnapshot } from "@kin/db";
import { calendarDay, type EntryKind } from "@kin/domain";

import { recordEntries, type EntryView } from "./record";

/** How often the parent hears money events: each as it happens, the day's, or the week's. */
export const ANNOUNCE_EVERY = ["now", "day", "week"] as const;
export type AnnounceEvery = (typeof ANNOUNCE_EVERY)[number];

export const DEFAULT_ANNOUNCE_EVERY: AnnounceEvery = "now";

export function isAnnounceEvery(value: unknown): value is AnnounceEvery {
  return ANNOUNCE_EVERY.some((each) => each === value);
}

/** The money events worth saying aloud: only what PayPal confirmed or the pool received. */
export const ANNOUNCED_KINDS = ["contribution", "payout_confirmed", "purchase_captured"] as const satisfies readonly EntryKind[];

const DAYS_BACK: Record<AnnounceEvery, number> = { now: 0, day: 1, week: 7 };
const DAY_MS = 86_400_000;

/**
 * What the parent hears for this rhythm, newest first. "As it happens" is the
 * latest event; a day or a week gathers every event since that many days ago.
 */
export function announcements(circle: CircleSnapshot, every: AnnounceEvery): EntryView[] {
  const events = recordEntries(circle).filter((view) => ANNOUNCED_KINDS.some((kind) => kind === view.entry.kind));
  if (every === "now") return events.slice(0, 1);
  const since = calendarDay(new Date(circle.circle.now.getTime() - DAYS_BACK[every] * DAY_MS), circle.circle.timezone).occurredOn;
  return events.filter((view) => view.entry.occurredOn >= since);
}
