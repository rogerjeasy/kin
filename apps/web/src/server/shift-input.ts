import { PAYOUT_WALLETS, type CircleSnapshot, type PayoutWallet } from "@kin/db";
import { InvalidDecimalError, SHIFT_KINDS, calendarDay, centsFromDecimal, type ShiftKind, type ShiftPermissionTerms } from "@kin/domain";

import { typedAmount } from "@/lib/typed-amount";

import { zonedInstant } from "./zoned-time";

/** Why a shift request could not be read, beyond a shape that is simply not the form's. */
export type ShiftInputFailure = "invalid" | "amount" | "bad_times" | "bad_date" | "bad_member" | "bad_payee";

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: ShiftInputFailure };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WHOLE = /^\d{1,4}$/;
const MAX_TITLE_CHARS = 80;
export const MAX_SPOKEN_CHARS = 400;
const MAX_RECEIVER_CHARS = 127;
const MAX_VISIT_MS = 24 * 60 * 60 * 1000;
const PAST_DAYS = 14;
const FUTURE_DAYS = 366;
const DAY_MS = 86_400_000;
// The same shapes the database accepts for a payout target, so a typo is told early and kindly.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Venmo is US-only, so only a US mobile number is taken: ten digits, with or without +1. The database and the PayPal adapter hold the same rule.
const US_PHONE = /^(\+?1)?[0-9]{10}$/;
const VENMO_HANDLE = /^@[A-Za-z0-9_-]{3,30}$/;

const fail = (reason: ShiftInputFailure): { ok: false; reason: ShiftInputFailure } => ({ ok: false, reason });
const succeed = <T>(value: T): Parsed<T> => ({ ok: true, value });

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Whether a request names no field the operation does not take. */
export function onlyKeys(row: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(row).every((key) => allowed.includes(key));
}

export function uuidField(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/** A shift as the schedule form sends it: a day and two clock times on the circle's own calendar. */
export type ScheduleDraft = { readonly kind: ShiftKind; readonly memberId: string; readonly title: string | null; readonly startsAt: Date; readonly endsAt: Date };

export function scheduleDraft(circle: CircleSnapshot, row: Record<string, unknown>): Parsed<ScheduleDraft> {
  const { kind, memberId, title, date, start, end } = row;
  const known = SHIFT_KINDS.find((each) => each === kind);
  if (known === undefined || typeof memberId !== "string" || typeof date !== "string" || typeof start !== "string" || typeof end !== "string") return fail("invalid");
  if (title !== undefined && (typeof title !== "string" || [...title].length > MAX_TITLE_CHARS || /\p{Cc}/u.test(title))) return fail("invalid");
  if (!circle.members.some((member) => member.id === memberId && member.status === "active")) return fail("bad_member");
  const { timezone, now } = circle.circle;
  const startsAt = zonedInstant(date, start, timezone);
  const endsAt = zonedInstant(date, end, timezone);
  if (startsAt === null || endsAt === null) return fail("invalid");
  if (endsAt.getTime() <= startsAt.getTime() || endsAt.getTime() - startsAt.getTime() >= MAX_VISIT_MS) return fail("bad_times");
  const offset = dayNumber(date) - dayNumber(calendarDay(now, timezone).occurredOn);
  if (offset < -PAST_DAYS || offset > FUTURE_DAYS) return fail("bad_date");
  const cleaned = typeof title === "string" ? title.trim() : "";
  return succeed({ kind: known, memberId, title: cleaned === "" ? null : cleaned, startsAt, endsAt });
}

/** The parent's permission as the form sends it: whole hours a day and a decimal cap, read digit by digit. */
export function permissionDraft(circle: CircleSnapshot, value: unknown): Parsed<ShiftPermissionTerms> {
  const draft = record(value);
  if (draft === null || !onlyKeys(draft, ["payeeId", "maxHours", "perShift", "validFrom", "expiresOn"])) return fail("invalid");
  const { payeeId, maxHours, perShift, validFrom, expiresOn } = draft;
  if (typeof payeeId !== "string" || typeof maxHours !== "string" || typeof perShift !== "string" || typeof validFrom !== "string" || typeof expiresOn !== "string") return fail("invalid");
  if (!circle.payees.some((payee) => payee.id === payeeId && payee.caregiverRateCentsPerHour !== null)) return fail("bad_payee");
  if (!WHOLE.test(maxHours.trim()) || !DAY.test(validFrom) || !DAY.test(expiresOn)) return fail("invalid");
  const { currency, now, timezone } = circle.circle;
  // A permission cannot start before today on the circle's calendar: it starts when it is spoken.
  const today = calendarDay(now, timezone).occurredOn;
  try {
    return succeed({ payeeId, maxMinutesPerDay: Number(maxHours.trim()) * 60, perShiftCents: centsFromDecimal(typedAmount(perShift), currency), validFrom: validFrom < today ? today : validFrom, expiresOn });
  } catch (error) {
    if (error instanceof InvalidDecimalError) return fail("amount");
    throw error;
  }
}

export type RulesDraft = { readonly payeeId: string; readonly minimumMinutes: number; readonly overtimeAfterMinutes: number | null; readonly overtimePercent: number };

/** A caregiver's pay rules: whole minutes, whole hours and a whole percent, for a caregiver this circle has rules for. */
export function rulesDraft(circle: CircleSnapshot, row: Record<string, unknown>): Parsed<RulesDraft> {
  const { payeeId, minimumMinutes, overtimeAfterHours, overtimePercent } = row;
  if (typeof payeeId !== "string" || !circle.shiftRules.some((rules) => rules.payeeId === payeeId)) return fail("bad_payee");
  const whole = (each: unknown, min: number, max: number): each is number => typeof each === "number" && Number.isSafeInteger(each) && each >= min && each <= max;
  if (!whole(minimumMinutes, 0, 1_440) || !whole(overtimePercent, 100, 300)) return fail("invalid");
  if (overtimeAfterHours !== null && !whole(overtimeAfterHours, 1, 24)) return fail("invalid");
  return succeed({ payeeId, minimumMinutes, overtimeAfterMinutes: overtimeAfterHours === null ? null : overtimeAfterHours * 60, overtimePercent });
}

export type TargetDraft = { readonly wallet: PayoutWallet; readonly receiver: string };

/** Where the caregiver's own pay goes: a PayPal email, or for Venmo an email, a phone number or an @handle. */
export function targetDraft(row: Record<string, unknown>): Parsed<TargetDraft> {
  const wallet = PAYOUT_WALLETS.find((each) => each === row["wallet"]);
  const receiver = row["receiver"];
  if (wallet === undefined || typeof receiver !== "string") return fail("invalid");
  const trimmed = receiver.trim();
  if (trimmed === "" || trimmed.length > MAX_RECEIVER_CHARS) return fail("invalid");
  const fits = EMAIL.test(trimmed) || (wallet === "venmo" && (US_PHONE.test(trimmed) || VENMO_HANDLE.test(trimmed)));
  return fits ? succeed({ wallet, receiver: trimmed }) : fail("invalid");
}
