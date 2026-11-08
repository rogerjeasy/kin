import type { ShiftKind } from "@kin/domain";

import type { PersonaKey } from "./roses-circle.ts";

/**
 * Amara's agreed rate (what her twelve hours of October cost: 264.00) and pay
 * rules, and the standing permission Rose spoke, written around the template's
 * clock like the rest of Rose's circle. Every figure is simulated and labelled
 * so. Her payout target is left as it was, for her to set, like any caregiver's.
 */
export const AMARA_PAY = {
  rateCentsPerHour: 2200,
  minimumMinutes: 60,
  overtimeAfterMinutes: 480,
  overtimePercent: 150,
} as const;

export const SHIFT_PERMISSION = {
  maxMinutesPerDay: 240,
  perShiftCents: 15000,
  validFrom: "2026-10-01",
  expiresOn: "2027-09-30",
  grantedAt: new Date("2026-10-02T15:30:00Z"),
  /** What Rose said, as Kin wrote it down. */
  spokenText: "Pay Amara for the shifts we confirm, up to four hours a day and up to one hundred fifty dollars a shift.",
} as const;

export type DemoShift = {
  readonly kind: ShiftKind;
  readonly title: string;
  readonly member: PersonaKey;
  readonly startsAt: Date;
  readonly endsAt: Date;
};

/** Amara's two shifts already paid under the permission, with the taps that proved them. */
export const PAID_SHIFTS: readonly (DemoShift & { readonly checkedInAt: Date; readonly checkedOutAt: Date })[] = [
  {
    kind: "aide",
    title: "Morning care",
    member: "amara",
    startsAt: new Date("2026-10-21T13:00:00Z"),
    endsAt: new Date("2026-10-21T16:30:00Z"),
    checkedInAt: new Date("2026-10-21T13:00:00Z"),
    checkedOutAt: new Date("2026-10-21T16:30:00Z"),
  },
  {
    kind: "aide",
    title: "Afternoon care",
    member: "amara",
    startsAt: new Date("2026-10-23T14:00:00Z"),
    endsAt: new Date("2026-10-23T18:00:00Z"),
    checkedInAt: new Date("2026-10-23T14:00:00Z"),
    checkedOutAt: new Date("2026-10-23T18:00:00Z"),
  },
];

/**
 * What waits on the calendar: Amara's shift today, which began four hours
 * before the demo clock and still needs her tap, and a few unpaid items over
 * the days after it.
 */
export const SCHEDULED_SHIFTS: readonly DemoShift[] = [
  { kind: "aide", title: "Day care", member: "amara", startsAt: new Date("2026-10-30T14:00:00Z"), endsAt: new Date("2026-10-30T20:00:00Z") },
  { kind: "visit", title: "Ana visits Rose", member: "ana", startsAt: new Date("2026-10-31T14:00:00Z"), endsAt: new Date("2026-10-31T16:00:00Z") },
  { kind: "drive", title: "Drive to physiotherapy", member: "ana", startsAt: new Date("2026-11-02T15:00:00Z"), endsAt: new Date("2026-11-02T16:00:00Z") },
  { kind: "aide", title: "Morning care", member: "amara", startsAt: new Date("2026-11-02T13:00:00Z"), endsAt: new Date("2026-11-02T17:00:00Z") },
  { kind: "appointment", title: "Hearing check follow-up", member: "rose", startsAt: new Date("2026-11-03T14:30:00Z"), endsAt: new Date("2026-11-03T15:30:00Z") },
];
