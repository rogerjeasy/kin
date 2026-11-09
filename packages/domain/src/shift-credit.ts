import { careValueCents } from "./care.ts";
import type { CircleRole } from "./roles.ts";
import { CREDITED_SHIFT_KINDS, workedMinutes, type ShiftKind } from "./shift.ts";

export { CREDITED_SHIFT_KINDS };

/**
 * A sibling's visit or drive is not paid, but it counts toward their fair
 * share once both keys have turned: the member's own check-in and check-out,
 * and the family's word. Plain code values it from the minutes at the care
 * rate the agreement names; the model never sets an hour or an amount.
 */


/** The roles that share the cost of care, and so are credited for time given. */
export const CREDITED_ROLES = ["organizer", "contributor"] as const satisfies readonly CircleRole[];

/** Whether a confirmed shift of this kind, done by a member of this role, is credited as care time. */
export function isCreditedKind(kind: ShiftKind, memberRole: CircleRole): boolean {
  return (CREDITED_SHIFT_KINDS as readonly string[]).includes(kind) && (CREDITED_ROLES as readonly string[]).includes(memberRole);
}

export type ShiftCredit = {
  /** Whole minutes between check-in and check-out; a partial minute is not credited. */
  readonly minutes: number;
  readonly cents: number;
};

/**
 * What a confirmed visit is worth as care credit: the whole minutes between
 * the two taps, valued with the care valuation at the agreement's rate. Throws
 * `ShiftPriceError` for a visit under a minute or over a day, and
 * `CareValueError` for a rate that cannot be applied.
 */
export function valueCreditedShift(checkedInAt: Date, checkedOutAt: Date, rateCentsPerHour: number): ShiftCredit {
  const minutes = workedMinutes(checkedInAt, checkedOutAt);
  return { minutes, cents: careValueCents(minutes, rateCentsPerHour) };
}
