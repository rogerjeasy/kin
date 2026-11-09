import type { ShiftRecord } from "@kin/db";
import { ShiftPriceError, workedMinutes, type ShiftPermissionRefusal } from "@kin/domain";

import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";
import type { ShiftFailure, ShiftOutcome } from "@/server/shifts";

export type ShiftCopy = Dictionary["dashboard"]["shifts"];

/** Every reason a shift request can be refused for. A test holds the dictionary to this list. */
export const SHIFT_FAILURES = {
  refused: true, invalid: true, key_reused: true, bad_member: true, wrong_state: true, visit_too_short: true, visit_too_long: true, own_shift: true,
  parent_can_answer: true, not_started: true, not_paid_kind: true, keys_missing: true, missing_rate: true, above_ceiling: true, paused: true,
  no_agreement: true, payment_in_progress: true, parent_only: true, no_parent: true, not_covered: true, care_agreement: true, invalid_target: true, not_money: true,
  bad_minutes: true, bad_dates: true, too_long: true, amount: true, bad_times: true, bad_date: true, bad_payee: true, unavailable: true,
  too_many_links: true, consent_needed: true, no_such_call: true, call_over: true, bad_phone: true, texting_off: true, text_limit: true,
} as const satisfies Record<ShiftFailure, true>;

/** The words for a refusal. A reason this version does not know reads as unavailable. */
export function failureText(copy: ShiftCopy, reason: string): string {
  return Object.hasOwn(copy.errors, reason) ? copy.errors[reason as keyof ShiftCopy["errors"]] : copy.errors.unavailable;
}

const MINUTES_PER_HOUR = 60;

/** "4 h", "45 min" or "3 h 30 min", from whole minutes. */
/**
 * The caregiver's two taps, and how long Kin counts between them. The times
 * are shown to the minute, but the count is the whole minutes between the
 * exact taps, so 2:25 PM to 8:00 PM can count 5 h 34 min; saying the count
 * beside the times keeps the price below from looking a minute short.
 */
export function tapsText(copy: ShiftCopy, format: Formatters, shift: Pick<ShiftRecord, "checkedInAt" | "checkedOutAt" | "workedMinutes">): string {
  if (shift.checkedInAt === null) return copy.keys.todo;
  if (shift.checkedOutAt === null) return fill(copy.keys.in, { start: format.time(shift.checkedInAt) });
  const times = { start: format.time(shift.checkedInAt), end: format.time(shift.checkedOutAt) };
  const counted = shift.workedMinutes ?? countable(shift.checkedInAt, shift.checkedOutAt);
  return counted === null ? fill(copy.keys.inOut, times) : fill(copy.keys.inOutCounted, { ...times, duration: durationText(copy, format, counted) });
}

/** The whole minutes between two taps, or `null` for a visit too short or too long to count, which the price says why. */
function countable(checkedInAt: Date, checkedOutAt: Date): number | null {
  try {
    return workedMinutes(checkedInAt, checkedOutAt);
  } catch (error) {
    if (error instanceof ShiftPriceError) return null;
    throw error;
  }
}

export function durationText(copy: ShiftCopy, format: Formatters, minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  if (hours === 0) return fill(copy.duration.minutes, { minutes: format.count(rest) });
  if (rest === 0) return fill(copy.duration.hours, { hours: format.count(hours) });
  return fill(copy.duration.both, { hours: format.count(hours), minutes: format.count(rest) });
}

/** "$140.00 for 4 h at $35.00 an hour": the price a shift was given, from its own record. `null` before it has one. */
export function priceText(copy: ShiftCopy, format: Formatters, shift: Pick<ShiftRecord, "cents" | "billableMinutes" | "rateCentsPerHour">): string | null {
  if (shift.cents === null || shift.billableMinutes === null || shift.rateCentsPerHour === null) return null;
  return fill(copy.price, { amount: format.money(shift.cents), duration: durationText(copy, format, shift.billableMinutes), rate: format.money(shift.rateCentsPerHour) });
}

/** Why the nearest standing permission did not cover a shift, or that none was there to. */
export function askReasonText(copy: ShiftCopy, reason: ShiftPermissionRefusal | null): string {
  return copy.askReasons[reason ?? "none"];
}

/** What the screen says once a key has turned. `kind` says which. */
export type TurnWords = { readonly text: string; /** The sentence that says why, when the family is asked. */ readonly detail: string | null; readonly toApprovals: boolean };

type Who = {
  readonly format: Formatters;
  readonly parent: string;
  /** The caregiver the shift is for. */
  readonly name: string;
  readonly wallet: "paypal" | "venmo";
  /** Whether the viewer is that caregiver, so the pay is theirs. */
  readonly toYou: boolean;
};

export function turnWords(copy: ShiftCopy, turn: "check_out" | "confirm", outcome: ShiftOutcome, who: Who): TurnWords {
  const { outcome: words } = copy;
  switch (outcome.kind) {
    case "paid_by_permission": {
      const slots = { amount: who.format.money(outcome.cents), parent: who.parent, name: who.name, wallet: copy.payment.wallets[who.wallet] };
      return { text: fill(who.toYou ? words.paidToYou : words.paid, slots), detail: null, toApprovals: false };
    }
    case "asks_family":
      return { text: fill(words.asks, { amount: who.format.money(outcome.cents) }), detail: askReasonText(copy, outcome.askReason), toApprovals: true };
    case "held":
      return { text: fill(words.held, { reason: failureText(copy, outcome.reason) }), detail: null, toApprovals: false };
    case "waiting":
      return { text: turn === "check_out" ? fill(words.checkedOutWaiting, { parent: who.parent }) : fill(words.confirmedWaiting, { name: who.name }), detail: null, toApprovals: false };
    case "declined_by_call":
      return { text: fill(words.declinedByCall, { parent: who.parent }), detail: null, toApprovals: false };
  }
}
