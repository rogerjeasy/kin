import type { Agreement, ApprovalTerms } from "./agreement.ts";
import { parentMustDecide, planApprovals, type ApprovalPlan, type Payee } from "./approval-plan.ts";
import { careValueCents } from "./care.ts";
import { assertCents, sumCents } from "./money.ts";
import type { MandateStatus } from "./mandate.ts";
import type { ParentLevel } from "./roles.ts";

/**
 * A care shift is paid when two independent keys turn: the caregiver's
 * check-in and check-out, and the family's word that the visit happened. Plain code prices
 * it from the minutes and the agreed rate, and decides whether the parent's
 * standing permission covers it. The model never sets an hour or an amount.
 */

/** The purpose key every proposal raised from a shift carries. */
export const SHIFT_PURPOSE = "shift";

export const SHIFT_KINDS = ["aide", "visit", "appointment", "drive"] as const;
export type ShiftKind = (typeof SHIFT_KINDS)[number];

/** Only an aide's shift is paid. A sibling's visit, an appointment and a drive sit on the calendar. */
export const isPaidShiftKind = (kind: ShiftKind): boolean => kind === "aide";

/** Where a shift stands, from docs/architecture.md section 7.4. A shift only moves forward. */
export const SHIFT_TRANSITIONS = {
  scheduled: ["checked_in", "cancelled"],
  // The family's word may come before check-out, so a visit still under way can already be confirmed.
  checked_in: ["checked_out", "confirmed", "cancelled"],
  checked_out: ["confirmed", "cancelled"],
  // An aide's confirmed shift is priced and paid; a sibling's visit or drive is credited as care time.
  confirmed: ["priced", "credited"],
  priced: ["paid"],
  paid: [],
  cancelled: [],
  credited: [],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type ShiftState = keyof typeof SHIFT_TRANSITIONS;
export const SHIFT_STATES = Object.keys(SHIFT_TRANSITIONS) as ShiftState[];

/** A shift was asked to make a move its diagram does not list. */
export class ShiftTransitionError extends Error {
  readonly retryable = false;
  readonly from: ShiftState;
  readonly to: ShiftState;

  constructor(from: ShiftState, to: ShiftState) {
    super(`A shift cannot move from ${from} to ${to}`);
    this.name = "ShiftTransitionError";
    this.from = from;
    this.to = to;
  }
}

export const shiftMoveAllowed = (from: ShiftState, to: ShiftState): boolean => (SHIFT_TRANSITIONS[from] as readonly ShiftState[]).includes(to);

/** Returns `to`, or throws if the diagram does not draw the move. */
export function advanceShift(from: ShiftState, to: ShiftState): ShiftState {
  if (!shiftMoveAllowed(from, to)) throw new ShiftTransitionError(from, to);
  return to;
}

/** What the two keys have said so far. */
export type ShiftKeys = {
  readonly checkedInAt: Date | null;
  readonly checkedOutAt: Date | null;
  readonly familyConfirmedAt: Date | null;
};

/** The caregiver's key needs both ends of the visit; the family's key is one word. Either alone leaves the shift pending. */
export function turnedKeys(keys: ShiftKeys): { readonly caregiver: boolean; readonly family: boolean; readonly both: boolean } {
  const caregiver = keys.checkedInAt !== null && keys.checkedOutAt !== null;
  const family = keys.familyConfirmedAt !== null;
  return { caregiver, family, both: caregiver && family };
}

/** What a shift waits for: the caregiver's check-in or check-out, or the family's word. `null` once both keys have turned. */
export type ShiftWaitingFor = "check_in" | "check_out" | "family_word" | null;

export function waitingFor(keys: ShiftKeys): ShiftWaitingFor {
  if (keys.checkedInAt === null) return "check_in";
  if (keys.checkedOutAt === null) return "check_out";
  return keys.familyConfirmedAt === null ? "family_word" : null;
}

const MINUTE_MS = 60_000;
export const MAX_SHIFT_MINUTES = 1_440;

/** The pay rules a family agreed for one caregiver, all whole numbers. */
export type ShiftRules = {
  readonly rateCentsPerHour: number;
  /** The least a visit is paid for, in minutes; 0 for none. */
  readonly minimumMinutes: number;
  /** Minutes in one shift paid at the normal rate; the rest are overtime. `null` for no overtime. */
  readonly overtimeAfterMinutes: number | null;
  /** The overtime rate as a whole percent of the normal rate, such as 150. */
  readonly overtimePercent: number;
};

export type ShiftPrice = {
  /** The minutes the caregiver was there, whole minutes, as the two taps recorded them. */
  readonly workedMinutes: number;
  /** The minutes paid for, which is never below the circle's minimum. */
  readonly billableMinutes: number;
  readonly regularMinutes: number;
  readonly overtimeMinutes: number;
  readonly regularCents: number;
  readonly overtimeCents: number;
  readonly cents: number;
};

/** The shift cannot be priced. Trying again with the same facts cannot help. */
export class ShiftPriceError extends Error {
  readonly retryable = false;
  readonly reason: "no_visit" | "too_long" | "bad_rules";

  constructor(reason: ShiftPriceError["reason"]) {
    super(`A shift cannot be priced: ${reason}`);
    this.name = "ShiftPriceError";
    this.reason = reason;
  }
}

/** Whole minutes between check-in and check-out; a partial minute is not paid. */
export function workedMinutes(checkedInAt: Date, checkedOutAt: Date): number {
  const minutes = Math.floor((checkedOutAt.getTime() - checkedInAt.getTime()) / MINUTE_MS);
  if (!Number.isSafeInteger(minutes) || minutes <= 0) throw new ShiftPriceError("no_visit");
  if (minutes > MAX_SHIFT_MINUTES) throw new ShiftPriceError("too_long");
  return minutes;
}

/**
 * What a visit is worth: the worked minutes, lifted to the minimum, with the
 * minutes past the overtime line at the overtime rate. Every step is integer
 * arithmetic with halves rounded up, as the care valuation is, and the
 * database computes the same figure again before it accepts one.
 */
export function priceShift(checkedInAt: Date, checkedOutAt: Date, rules: ShiftRules): ShiftPrice {
  assertRules(rules);
  const worked = workedMinutes(checkedInAt, checkedOutAt);
  const billable = Math.max(worked, rules.minimumMinutes);
  const regular = rules.overtimeAfterMinutes === null ? billable : Math.min(billable, rules.overtimeAfterMinutes);
  const overtime = billable - regular;
  const regularCents = regular > 0 ? careValueCents(regular, rules.rateCentsPerHour) : 0;
  const overtimeCents = overtime > 0 ? careValueCents(overtime, overtimeRateCentsPerHour(rules)) : 0;
  return {
    workedMinutes: worked,
    billableMinutes: billable,
    regularMinutes: regular,
    overtimeMinutes: overtime,
    regularCents,
    overtimeCents,
    cents: sumCents([regularCents, overtimeCents]),
  };
}

/** The overtime hourly rate in whole cents, halves rounded up. */
export function overtimeRateCentsPerHour(rules: Pick<ShiftRules, "rateCentsPerHour" | "overtimePercent">): number {
  return Math.floor((rules.rateCentsPerHour * rules.overtimePercent + 50) / 100);
}

function assertRules(rules: ShiftRules): void {
  const wholes = [rules.rateCentsPerHour, rules.minimumMinutes, rules.overtimePercent];
  if (rules.overtimeAfterMinutes !== null) wholes.push(rules.overtimeAfterMinutes);
  if (!wholes.every((value) => Number.isSafeInteger(value) && value >= 0)) throw new ShiftPriceError("bad_rules");
  if (rules.rateCentsPerHour === 0 || rules.overtimePercent < 100 || rules.overtimePercent > 300 || rules.minimumMinutes > MAX_SHIFT_MINUTES) throw new ShiftPriceError("bad_rules");
  if (rules.overtimeAfterMinutes !== null && (rules.overtimeAfterMinutes === 0 || rules.overtimeAfterMinutes > MAX_SHIFT_MINUTES)) throw new ShiftPriceError("bad_rules");
}

/** The default rules before an organizer sets any: no minimum, no overtime. */
export const DEFAULT_SHIFT_RULES = { minimumMinutes: 0, overtimeAfterMinutes: null, overtimePercent: 150 } as const;

// ---------------------------------------------------------------------------
// The parent's standing permission to pay confirmed shifts
// ---------------------------------------------------------------------------

/** A standing permission may not run longer than a year without being spoken again. */
export const MAX_SHIFT_PERMISSION_DAYS = 366;
/** No permission allows more than a day's worth of hours. */
export const MAX_PERMISSION_MINUTES_PER_DAY = MAX_SHIFT_MINUTES;

/**
 * What the parent allowed, as the schema Kin compiles her words into: "pay
 * Amara for confirmed shifts, up to 4 hours a day". Dates are YYYY-MM-DD on
 * the circle's calendar.
 */
export type ShiftPermissionTerms = {
  /** The caregiver's payee row it covers. */
  readonly payeeId: string;
  readonly maxMinutesPerDay: number;
  /** The most one shift may be paid without asking, in the circle's currency. */
  readonly perShiftCents: number;
  readonly validFrom: string;
  readonly expiresOn: string;
};

export type ShiftPermission = ShiftPermissionTerms & { readonly permissionId: string; readonly status: MandateStatus };

export type ShiftPermissionTermsRefusal = "not_money" | "bad_minutes" | "above_ceiling" | "bad_dates" | "too_long";

/** The words of a standing permission cannot be accepted. Asking again with the same words cannot help. */
export class ShiftPermissionTermsError extends Error {
  readonly retryable = false;
  readonly reason: ShiftPermissionTermsRefusal;

  constructor(reason: ShiftPermissionTermsRefusal) {
    super(`A shift permission cannot be granted: ${reason}`);
    this.name = "ShiftPermissionTermsError";
    this.reason = reason;
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/** Whether terms may be granted. A permission never lifts the agreement's ceiling, and it ends within a year. */
export function checkShiftPermissionTerms(terms: ShiftPermissionTerms, ceilingCents: number): void {
  for (const value of [terms.perShiftCents, ceilingCents]) assertCents(value);
  if (terms.perShiftCents <= 0) throw new ShiftPermissionTermsError("not_money");
  if (!Number.isSafeInteger(terms.maxMinutesPerDay) || terms.maxMinutesPerDay <= 0 || terms.maxMinutesPerDay > MAX_PERMISSION_MINUTES_PER_DAY) {
    throw new ShiftPermissionTermsError("bad_minutes");
  }
  if (terms.perShiftCents > ceilingCents) throw new ShiftPermissionTermsError("above_ceiling");
  if (!DAY.test(terms.validFrom) || !DAY.test(terms.expiresOn) || Number.isNaN(dayNumber(terms.validFrom)) || Number.isNaN(dayNumber(terms.expiresOn))) {
    throw new ShiftPermissionTermsError("bad_dates");
  }
  const days = dayNumber(terms.expiresOn) - dayNumber(terms.validFrom);
  if (days <= 0) throw new ShiftPermissionTermsError("bad_dates");
  if (days > MAX_SHIFT_PERMISSION_DAYS) throw new ShiftPermissionTermsError("too_long");
}

/** How far a permission's per-shift cap reaches above what the parent usually decides herself, in cents; 0 when it does not. */
export function shiftPermissionExcessAboveParentLimit(terms: ShiftPermissionTerms, parentLevel: ParentLevel, approvals: ApprovalTerms): number {
  assertCents(terms.perShiftCents);
  return parentMustDecide(terms.perShiftCents, parentLevel, approvals) ? terms.perShiftCents - approvals.parentDecidesAboveCents : 0;
}

export type ShiftPermissionRefusal =
  | "not_active"
  | "paused"
  | "not_started"
  | "expired"
  | "circle_paused"
  | "other_caregiver"
  | "above_per_shift"
  | "over_daily_hours";

/** One shift, priced, as the permission is checked against it. */
export type ShiftToPay = {
  readonly payeeId: string;
  /** The circle's calendar day the shift began on. */
  readonly day: string;
  readonly billableMinutes: number;
  readonly cents: number;
};

export type ShiftPermissionCandidate = {
  readonly permission: ShiftPermission;
  /** The circle's calendar day now. */
  readonly today: string;
  readonly circlePaused: boolean;
  /** Minutes of other shifts of this caregiver on `shift.day` already paid or waiting, under this permission. */
  readonly minutesUsedThatDay: number;
};

/**
 * Whether a priced shift fits a standing permission, as the first reason it
 * does not, or `null`. Pure: the caller passes the day and what that day has
 * already used. A shift that fits none is never paid without a live yes.
 */
export function checkShiftPermission(candidate: ShiftPermissionCandidate, shift: ShiftToPay): ShiftPermissionRefusal | null {
  const { permission, today, circlePaused, minutesUsedThatDay } = candidate;
  assertCents(shift.cents);
  for (const value of [shift.billableMinutes, minutesUsedThatDay, permission.maxMinutesPerDay]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`A minute count must be a whole number, got ${value}`);
  }
  if (permission.status === "revoked") return "not_active";
  if (permission.status === "paused") return "paused";
  if (today < permission.validFrom) return "not_started";
  if (today > permission.expiresOn) return "expired";
  if (circlePaused) return "circle_paused";
  if (shift.payeeId !== permission.payeeId) return "other_caregiver";
  if (shift.day < permission.validFrom || shift.day > permission.expiresOn) return "expired";
  if (shift.cents > permission.perShiftCents) return "above_per_shift";
  if (minutesUsedThatDay + shift.billableMinutes > permission.maxMinutesPerDay) return "over_daily_hours";
  return null;
}

export type ShiftPermissionDecision =
  | { readonly outcome: "covered"; readonly permissionId: string }
  | { readonly outcome: "ask_family"; readonly permissionId: string; readonly reason: ShiftPermissionRefusal };

/**
 * Decides among the permissions that could cover a shift: the first that fits
 * pays it at once, and otherwise the family is asked and told why the nearest
 * one did not fit. `null` means no live permission exists for the caregiver.
 */
export function decideShiftPermission(candidates: readonly ShiftPermissionCandidate[], shift: ShiftToPay): ShiftPermissionDecision | null {
  let asked: ShiftPermissionDecision | null = null;
  for (const candidate of candidates) {
    const reason = checkShiftPermission(candidate, shift);
    if (reason === null) return { outcome: "covered", permissionId: candidate.permission.permissionId };
    if (candidate.permission.status === "revoked" || candidate.permission.payeeId !== shift.payeeId) continue;
    asked ??= { outcome: "ask_family", permissionId: candidate.permission.permissionId, reason };
  }
  return asked;
}

export type ShiftPayoutRequest = {
  readonly cents: number;
  readonly payee: Payee;
  readonly agreement: Pick<Agreement, "version" | "approvals">;
  readonly parentLevel: ParentLevel;
  readonly pausedUntil: Date | null;
  readonly now: Date;
};

/**
 * Who must say yes when a shift does not fit a standing permission. The
 * amount is the shift's own price, never a figure typed by whoever sends it,
 * and the caregiver is the payee member, so they can never be the only yes.
 */
export function planShiftPayout(request: ShiftPayoutRequest): ApprovalPlan {
  return planApprovals({
    kind: "caregiver_payout",
    cents: request.cents,
    payee: request.payee,
    agreement: request.agreement,
    parentLevel: request.parentLevel,
    pausedUntil: request.pausedUntil,
    now: request.now,
  });
}

/** Whether a member may give the family's word for a shift, as the first reason they may not, or `null`. */
export type ShiftWordRefusal = "own_shift" | "role_cannot" | "parent_can_answer";

export type ShiftWordRequest = {
  readonly role: "organizer" | "contributor" | "parent" | "caregiver" | "observer";
  /** The member giving the word and the member on the shift. */
  readonly memberId: string;
  readonly shiftMemberId: string;
  /** Whether an active parent in the circle takes part in decisions herself. */
  readonly parentDecides: boolean;
  /** A demo circle lets the organizer stand in for the parent's spoken word. */
  readonly demo: boolean;
};

/**
 * The parent's word always counts. A sibling's confirmation counts only where
 * the parent cannot give it, and nobody confirms their own shift. A caregiver
 * and an observer never give the family's word.
 */
export function mayConfirmShift(request: ShiftWordRequest): ShiftWordRefusal | null {
  if (request.memberId === request.shiftMemberId) return "own_shift";
  if (request.role === "parent") return null;
  if (request.role !== "organizer" && request.role !== "contributor") return "role_cannot";
  if (request.parentDecides && !request.demo) return "parent_can_answer";
  return null;
}

/** The day a shift counts against: the circle's calendar day on which it began. */
export function shiftDay(startedAt: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(startedAt);
  const part = (type: "year" | "month" | "day"): string => {
    const value = parts.find((each) => each.type === type)?.value;
    if (value === undefined) throw new RangeError(`No ${type} for ${startedAt.toISOString()} in ${timezone}`);
    return value;
  };
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The part of the day an instant falls in, on the circle's clock. */
export function dayPart(instant: Date, timezone: string): "morning" | "afternoon" | "evening" {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(instant));
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}
