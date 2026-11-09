import type { CircleSnapshot, ShiftRecord } from "@kin/db";
import { shiftDay, takesKeys, turnedKeys, visitDayPart, type ShiftState } from "@kin/domain";

import { familyWordRefusal, mayHearCall } from "@/server/shift-access";
import { may } from "@/server/dashboard-context";

import type { ShiftWeek } from "./shift-week";

/** How a shift is drawn: scheduled, waiting for a key, both keys turned, paid, cancelled. */
export type ShiftTone = "neutral" | "pending" | "ready" | "paid" | "cancelled";

/** Where a shift's payment stands once it has one. */
export type PaymentStage = "paid" | "sending" | "waiting_family" | "declined" | "failed";

/** What a state chip says: the shift's own state, refined once its payment exists. */
export type ShiftChip = ShiftState | "awaits_approval" | "being_paid" | "declined" | "payment_failed";

/** Only an aide's shift is paid, but a sibling's visit is proven the same way, by the same two keys. */
const OPEN_STATES: readonly ShiftState[] = ["scheduled", "checked_in", "checked_out"];
/** A check-in link only helps while a tap is still to come, and the database lets it live six hours past the planned end. */
const LINKABLE_STATES: readonly ShiftState[] = ["scheduled", "checked_in"];
const LINK_GRACE_MS = 6 * 3_600_000;
/** States a shift can still move on from by itself or by someone's tap, so the screen keeps looking. */
const MOVING_STATES: readonly ShiftState[] = ["checked_in", "checked_out", "confirmed", "priced"];
/** A payment older than this is history, not news, on a caregiver's screen. */
const NEWS_DAYS = 14;
const DAY_MS = 86_400_000;

export type ShiftView = {
  readonly shift: ShiftRecord;
  /** The day it began on, on the circle's calendar. */
  readonly day: string;
  readonly tone: ShiftTone;
  readonly chip: ShiftChip;
  readonly keys: ReturnType<typeof turnedKeys>;
  /** The payment's stage, or `null` before the shift has one. */
  readonly payment: PaymentStage | null;
  /** The wallet the payment goes to, when the viewer may know it. */
  readonly wallet: "paypal" | "venmo" | null;
  readonly byPermission: boolean;
  /** Whether the viewer may call it off. */
  readonly canCancel: boolean;
  /** Whether the viewer may make a no-login check-in link for it. */
  readonly canLink: boolean;
  /** Whether a demo circle can play Kin's call about it to the viewer. */
  readonly canHearCall: boolean;
};

/** What the viewer is asked to do now: tap in, tap out, or give the family's word. */
export type Need = {
  readonly shift: ShiftRecord;
  readonly kind: "check_in" | "check_out" | "word";
  /** "morning", "afternoon" or "evening", of the visit's planned start, on the circle's clock. */
  readonly part: "morning" | "afternoon" | "evening";
};

const keyed = (shift: ShiftRecord): boolean => takesKeys(shift.kind);

function paymentStage(shift: ShiftRecord): PaymentStage | null {
  if (shift.state === "paid") return "paid";
  if (shift.state !== "priced") return null;
  switch (shift.proposalState) {
    case "pending_approval":
      return "waiting_family";
    case "rejected":
    case "expired":
      return "declined";
    case "failed":
      return "failed";
    case "settled":
      return "paid";
    default:
      return "sending";
  }
}

function chipOf(shift: ShiftRecord, payment: PaymentStage | null): ShiftChip {
  if (shift.state !== "priced") return shift.state;
  return payment === "waiting_family" ? "awaits_approval" : payment === "declined" ? "declined" : payment === "failed" ? "payment_failed" : "being_paid";
}

function toneOf(shift: ShiftRecord, payment: PaymentStage | null): ShiftTone {
  if (shift.state === "cancelled") return "cancelled";
  // A credited visit is as finished as a paid shift, and draws the same.
  if (shift.state === "paid" || shift.state === "credited" || payment === "paid") return "paid";
  if (shift.state === "confirmed" || shift.state === "priced") return "ready";
  return shift.state === "scheduled" ? "neutral" : "pending";
}

function viewOf(circle: CircleSnapshot, shift: ShiftRecord): ShiftView {
  const payment = paymentStage(shift);
  const { role, memberId } = circle.viewer;
  return {
    shift,
    day: shiftDay(shift.startsAt, circle.circle.timezone),
    tone: toneOf(shift, payment),
    chip: chipOf(shift, payment),
    keys: turnedKeys(shift),
    payment,
    wallet: circle.shiftRules.find((rules) => rules.payeeId === shift.payeeId)?.payoutWallet ?? null,
    byPermission: shift.permissionId !== null,
    // The database lets the member it is for, an organizer or the parent call a shift off.
    canCancel: may(circle, "shift.cancel") && OPEN_STATES.includes(shift.state) && (shift.memberId === memberId || role === "organizer" || role === "parent"),
    // The database lets the member it is for and those who run the calendar make one, for the two kinds that are tapped.
    canLink: may(circle, "shift.link") && keyed(shift) && LINKABLE_STATES.includes(shift.state) && shift.endsAt.getTime() + LINK_GRACE_MS > circle.circle.now.getTime() && (shift.memberId === memberId || role !== "caregiver"),
    canHearCall: mayHearCall(circle, shift),
  };
}

/** The shifts that begin in a week, in the order they begin. */
export function shiftViews(circle: CircleSnapshot, week: ShiftWeek): ShiftView[] {
  return circle.shifts
    .map((shift) => viewOf(circle, shift))
    .filter((view) => view.day >= week.start && view.day <= week.end)
    .toSorted((a, b) => a.shift.startsAt.getTime() - b.shift.startsAt.getTime() || a.shift.id.localeCompare(b.shift.id));
}

/**
 * What the viewer is asked for now, whatever week is on show: their own shift
 * to tap in on (from the day it begins) or out of, and the visits that have
 * begun and wait for the family's word, when the viewer is one who may give it.
 */
export function needsOf(circle: CircleSnapshot): Need[] {
  const { timezone, now } = circle.circle;
  const today = shiftDay(now, timezone);
  const needs: Need[] = [];
  for (const shift of circle.shifts) {
    if (!keyed(shift)) continue;
    const part = visitDayPart(shift, timezone);
    const own = shift.memberId === circle.viewer.memberId && may(circle, "shift.check");
    if (own && shift.state === "scheduled" && shiftDay(shift.startsAt, timezone) <= today) needs.push({ shift, kind: "check_in", part });
    else if (own && shift.state === "checked_in") needs.push({ shift, kind: "check_out", part });
    if (!own && (shift.state === "checked_in" || shift.state === "checked_out") && shift.familyConfirmedAt === null && familyWordRefusal(circle, shift) === null) needs.push({ shift, kind: "word", part });
  }
  return needs.toSorted((a, b) => a.shift.startsAt.getTime() - b.shift.startsAt.getTime());
}

/** The viewer's own shift that has been paid most recently, if the news is fresh: what a caregiver is told came in. */
export function latestPaid(circle: CircleSnapshot): ShiftView | null {
  const mine = circle.shifts.filter((shift) => shift.memberId === circle.viewer.memberId && shift.state === "paid" && shift.cents !== null && shift.checkedOutAt !== null);
  const [latest] = mine.toSorted((a, b) => (b.checkedOutAt?.getTime() ?? 0) - (a.checkedOutAt?.getTime() ?? 0));
  if (latest === undefined || latest.checkedOutAt === null || circle.circle.now.getTime() - latest.checkedOutAt.getTime() > NEWS_DAYS * DAY_MS) return null;
  return viewOf(circle, latest);
}

/** Whether anything on the calendar can still change by itself, such as a payment on its way, so the screen keeps looking. */
export function anythingMoving(circle: CircleSnapshot): boolean {
  return circle.shifts.some((shift) => MOVING_STATES.includes(shift.state));
}
