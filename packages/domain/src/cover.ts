import type { CircleRole } from "./roles.ts";
import { shiftDay, type ShiftKind, type ShiftState } from "./shift.ts";

/**
 * When an aide calls off a shift that has not happened yet, who could take it?
 * Plain code ranks the people who are free; a person chooses and schedules
 * the cover through the ordinary scheduling operation. Nothing here books,
 * pays or reads the clock: the window, the people and their shifts are passed
 * in. Pay is not part of the ranking, and no amount appears in the result.
 */

/** The gap kept between a cover shift and the person's neighbouring shifts, so nobody is booked back to back. */
export const COVER_BUFFER_MINUTES = 30;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

/** Someone in the circle who might take the shift. */
export type CoverMember = {
  readonly memberId: string;
  readonly role: CircleRole;
  readonly active: boolean;
  /** Whether the member is a caregiver with an agreed hourly rate: only then can an aide shift be paid to them. */
  readonly hasRate: boolean;
};

/** A shift as the ranking needs it: whose, when and where it stands. */
export type CoverShift = {
  readonly memberId: string;
  readonly kind: ShiftKind;
  readonly state: ShiftState;
  readonly startsAt: Date;
  readonly endsAt: Date;
};

export type CoverRequest = {
  /** The cancelled shift's own window. */
  readonly window: { readonly startsAt: Date; readonly endsAt: Date };
  /** The member who called the shift off: never offered their own shift back. */
  readonly cancelledBy: string;
  readonly members: readonly CoverMember[];
  readonly shifts: readonly CoverShift[];
  /** The circle's IANA zone: the day and the week are its own calendar's. */
  readonly timezone: string;
  /** The gap to keep between shifts, in minutes. Defaults to `COVER_BUFFER_MINUTES`. */
  readonly bufferMinutes?: number;
};

/**
 * A caregiver's cover is an `aide` shift, paid like any aide shift. A
 * sibling's or other family member's cover is a `visit`, which counts as a care visit.
 */
export type CoverKind = Extract<ShiftKind, "aide" | "visit">;

export type CoverCandidate = {
  readonly memberId: string;
  readonly kind: CoverKind;
  /** Minutes the member already has on the calendar on the window's day, on the circle's clock. */
  readonly minutesThatDay: number;
  /** Minutes the member already has in the window's Monday-to-Sunday week. */
  readonly minutesThisWeek: number;
};

/** A cancelled aide shift still to come is the one that needs cover. Any other shift does not. */
export function shiftNeedsCover(shift: Pick<CoverShift, "kind" | "state" | "startsAt">, now: Date): boolean {
  return shift.kind === "aide" && shift.state === "cancelled" && shift.startsAt.getTime() > now.getTime();
}

/**
 * Whether someone has already been put on the cancelled shift's own window as an aide or a family visit, in any state
 * but cancelled. The card that offers cover then has nothing left to ask.
 */
export function coverIsTaken(cancelled: Pick<CoverShift, "startsAt" | "endsAt">, shifts: readonly CoverShift[]): boolean {
  return shifts.some(
    (shift) => (shift.kind === "aide" || shift.kind === "visit") && shift.state !== "cancelled" && shift.startsAt.getTime() === cancelled.startsAt.getTime() && shift.endsAt.getTime() === cancelled.endsAt.getTime(),
  );
}

/** The kind of shift a member could cover, or `null` when they cannot: a parent, an observer and a caregiver with no rate cannot. */
export function coverKindOf(member: Pick<CoverMember, "role" | "active" | "hasRate">): CoverKind | null {
  if (!member.active) return null;
  if (member.role === "organizer" || member.role === "contributor") return "visit";
  return member.role === "caregiver" && member.hasRate ? "aide" : null;
}

const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/** The Monday of the week a calendar day falls in. 1970-01-01 was a Thursday, so day 0 is Thursday. */
const mondayNumber = (day: string): number => {
  const number = dayNumber(day);
  return number - ((number + 3) % WEEK_DAYS);
};

const minutesOf = (shift: CoverShift): number => Math.max(0, Math.round((shift.endsAt.getTime() - shift.startsAt.getTime()) / MINUTE_MS));

/** Whether another shift is too close to the window: it overlaps it or sits within the buffer of its edges. */
function crowds(shift: CoverShift, window: CoverRequest["window"], bufferMs: number): boolean {
  return shift.startsAt.getTime() < window.endsAt.getTime() + bufferMs && shift.endsAt.getTime() > window.startsAt.getTime() - bufferMs;
}

/** Plain code-unit order, so the same IDs sort the same way on every machine and in every locale. */
const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Who could cover the window, best first: the people with the fewest hours
 * already on that calendar day, then the fewest that week, then by member ID
 * so equal people always come in the same order. A member is left out when
 * they cannot take the kind of shift (see `coverKindOf`), called the shift
 * off themselves, or have any shift that is not cancelled within the buffer
 * of the window. A shift counts whatever state it stands in, as long as it
 * has not been called off, because a person who is on the calendar is busy.
 */
export function coverCandidates(request: CoverRequest): CoverCandidate[] {
  const { window, members, shifts, timezone } = request;
  const bufferMs = (request.bufferMinutes ?? COVER_BUFFER_MINUTES) * MINUTE_MS;
  const day = shiftDay(window.startsAt, timezone);
  const week = mondayNumber(day);
  const standing = shifts.filter((shift) => shift.state !== "cancelled");
  const candidates: CoverCandidate[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    const kind = coverKindOf(member);
    if (kind === null || member.memberId === request.cancelledBy || seen.has(member.memberId)) continue;
    seen.add(member.memberId);
    const own = standing.filter((shift) => shift.memberId === member.memberId);
    if (own.some((shift) => crowds(shift, window, bufferMs))) continue;
    let minutesThatDay = 0;
    let minutesThisWeek = 0;
    for (const shift of own) {
      const startedOn = shiftDay(shift.startsAt, timezone);
      const offset = dayNumber(startedOn) - week;
      if (offset < 0 || offset >= WEEK_DAYS) continue;
      minutesThisWeek += minutesOf(shift);
      if (startedOn === day) minutesThatDay += minutesOf(shift);
    }
    candidates.push({ memberId: member.memberId, kind, minutesThatDay, minutesThisWeek });
  }
  return candidates.toSorted((a, b) => a.minutesThatDay - b.minutesThatDay || a.minutesThisWeek - b.minutesThisWeek || compareIds(a.memberId, b.memberId));
}
