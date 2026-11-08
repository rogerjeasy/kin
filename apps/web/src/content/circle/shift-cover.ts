import type { CircleSnapshot, ShiftRecord } from "@kin/db";
import { coverCandidates, coverIsTaken, shiftDay, shiftNeedsCover, type CoverCandidate, type CoverMember, type CoverShift } from "@kin/domain";

import { may } from "@/server/dashboard-context";

/** How many cancelled shifts, and how many people for each, the screen offers at once. */
export const MAX_COVER_CARDS = 3;
export const MAX_COVER_PEOPLE = 3;
/** A cancelled shift further away than this is not yet worth a card. */
const HORIZON_DAYS = 28;
const DAY_MS = 86_400_000;

/** The day and the two clock times the schedule operation takes, on the circle's own calendar. */
export type CoverWindow = { readonly date: string; readonly start: string; readonly end: string };

/** One cancelled aide shift still to come, and who could take it, best first. */
export type CoverNeed = {
  readonly shift: ShiftRecord;
  readonly candidates: readonly CoverCandidate[];
  /** `null` when the shift runs past midnight, which the schedule form cannot put on the calendar in one go. */
  readonly window: CoverWindow | null;
};

function wallTime(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const part = (type: "hour" | "minute") => parts.find((each) => each.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

function windowOf(shift: ShiftRecord, timezone: string): CoverWindow | null {
  const date = shiftDay(shift.startsAt, timezone);
  if (shiftDay(shift.endsAt, timezone) !== date) return null;
  return { date, start: wallTime(shift.startsAt, timezone), end: wallTime(shift.endsAt, timezone) };
}

const toCoverShift = (shift: ShiftRecord): CoverShift => ({ memberId: shift.memberId, kind: shift.kind, state: shift.state, startsAt: shift.startsAt, endsAt: shift.endsAt });

function coverMembers(circle: CircleSnapshot): CoverMember[] {
  const rated = new Set(circle.payees.filter((payee) => payee.caregiverRateCentsPerHour !== null).flatMap((payee) => (payee.payee.member ? [payee.payee.member.memberId] : [])));
  return circle.members.map((member) => ({ memberId: member.id, role: member.role, active: member.status === "active", hasRate: rated.has(member.id) }));
}

/**
 * The aide shifts that were called off and have not happened yet, with the
 * people who could cover each. Only a seat that may schedule sees any: nobody
 * else could act on it, and a caregiver reads only their own shifts anyway.
 * Plain code ranks the people (`coverCandidates`); nothing is booked here.
 */
export function coverNeeds(circle: CircleSnapshot): CoverNeed[] {
  if (!may(circle, "shift.schedule")) return [];
  const { now, timezone } = circle.circle;
  const horizon = now.getTime() + HORIZON_DAYS * DAY_MS;
  const shifts = circle.shifts.map(toCoverShift);
  const members = coverMembers(circle);
  return circle.shifts
    .filter((shift) => shiftNeedsCover(shift, now) && shift.startsAt.getTime() <= horizon && !coverIsTaken(shift, shifts))
    .toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, MAX_COVER_CARDS)
    .map((shift) => ({
      shift,
      window: windowOf(shift, timezone),
      candidates: coverCandidates({ window: shift, cancelledBy: shift.memberId, members, shifts, timezone }).slice(0, MAX_COVER_PEOPLE),
    }));
}
