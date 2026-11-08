import { describe, expect, it } from "vitest";

import {
  ShiftPermissionTermsError,
  ShiftPriceError,
  ShiftTransitionError,
  advanceShift,
  checkShiftPermission,
  checkShiftPermissionTerms,
  dayPart,
  decideShiftPermission,
  mayConfirmShift,
  overtimeRateCentsPerHour,
  priceShift,
  shiftDay,
  shiftMoveAllowed,
  turnedKeys,
  waitingFor,
  workedMinutes,
  SHIFT_TRANSITIONS,
  type ShiftPermission,
  type ShiftPermissionCandidate,
  type ShiftRules,
  type ShiftState,
  type ShiftToPay,
} from "./shift.ts";
import { careValueCents } from "./care.ts";
import { forAll } from "./testing/index.ts";

const at = (time: string): Date => new Date(`2026-11-09T${time}:00Z`);
const rules: ShiftRules = { rateCentsPerHour: 3_500, minimumMinutes: 0, overtimeAfterMinutes: null, overtimePercent: 150 };

describe("the shift state machine", () => {
  it("moves a visit forward from scheduled to paid", () => {
    let state: ShiftState = "scheduled";
    for (const next of ["checked_in", "checked_out", "confirmed", "priced", "paid"] as const) state = advanceShift(state, next);
    expect(state).toBe("paid");
  });

  it("moves a sibling's visit forward from scheduled to credited, and never through pricing", () => {
    let state: ShiftState = "scheduled";
    for (const next of ["checked_in", "checked_out", "confirmed", "credited"] as const) state = advanceShift(state, next);
    expect(state).toBe("credited");
    expect(shiftMoveAllowed("credited", "priced")).toBe(false);
    expect(shiftMoveAllowed("priced", "credited")).toBe(false);
    expect(shiftMoveAllowed("checked_out", "credited")).toBe(false);
  });

  it("lets the family's word land while the visit is still under way", () => {
    expect(shiftMoveAllowed("checked_in", "confirmed")).toBe(true);
  });

  it.each([
    ["scheduled", "paid"],
    ["scheduled", "confirmed"],
    ["checked_out", "checked_in"],
    ["confirmed", "scheduled"],
    ["priced", "confirmed"],
    ["paid", "priced"],
    ["credited", "confirmed"],
    ["credited", "cancelled"],
    ["cancelled", "scheduled"],
    ["confirmed", "cancelled"],
  ] as const)("refuses %s to %s", (from, to) => {
    expect(shiftMoveAllowed(from, to)).toBe(false);
    expect(() => advanceShift(from, to)).toThrow(ShiftTransitionError);
  });

  it("has final states that nothing follows", () => {
    expect(SHIFT_TRANSITIONS.paid).toEqual([]);
    expect(SHIFT_TRANSITIONS.cancelled).toEqual([]);
    expect(SHIFT_TRANSITIONS.credited).toEqual([]);
  });
});

describe("the two keys", () => {
  const none = { checkedInAt: null, checkedOutAt: null, familyConfirmedAt: null };

  it("leaves a shift pending on either key alone", () => {
    expect(turnedKeys({ ...none, checkedInAt: at("08:00"), checkedOutAt: at("12:00") })).toEqual({ caregiver: true, family: false, both: false });
    expect(turnedKeys({ ...none, familyConfirmedAt: at("11:00") })).toEqual({ caregiver: false, family: true, both: false });
  });

  it("needs both ends of the visit for the caregiver's key", () => {
    expect(turnedKeys({ ...none, checkedInAt: at("08:00"), familyConfirmedAt: at("09:00") }).both).toBe(false);
  });

  it("turns when the caregiver has been and gone and the family has said so", () => {
    expect(turnedKeys({ checkedInAt: at("08:00"), checkedOutAt: at("12:00"), familyConfirmedAt: at("12:05") }).both).toBe(true);
  });

  it("says what the shift waits for", () => {
    expect(waitingFor(none)).toBe("check_in");
    expect(waitingFor({ ...none, checkedInAt: at("08:00") })).toBe("check_out");
    expect(waitingFor({ checkedInAt: at("08:00"), checkedOutAt: at("12:00"), familyConfirmedAt: null })).toBe("family_word");
    expect(waitingFor({ checkedInAt: at("08:00"), checkedOutAt: at("12:00"), familyConfirmedAt: at("12:01") })).toBeNull();
  });
});

describe("priceShift", () => {
  it("pays a four hour visit at the agreed rate: 140 dollars", () => {
    const price = priceShift(at("08:00"), at("12:00"), rules);
    expect(price).toMatchObject({ workedMinutes: 240, billableMinutes: 240, overtimeMinutes: 0, cents: 14_000 });
  });

  it("does not pay a partial minute", () => {
    expect(workedMinutes(new Date("2026-11-09T08:00:00Z"), new Date("2026-11-09T08:59:59Z"))).toBe(59);
  });

  it("lifts a short visit to the circle's minimum", () => {
    const price = priceShift(at("08:00"), at("08:20"), { ...rules, minimumMinutes: 60 });
    expect(price).toMatchObject({ workedMinutes: 20, billableMinutes: 60, cents: 3_500 });
  });

  it("pays minutes past the overtime line at the overtime rate", () => {
    const price = priceShift(at("08:00"), at("18:00"), { ...rules, overtimeAfterMinutes: 480 });
    expect(price.regularMinutes).toBe(480);
    expect(price.overtimeMinutes).toBe(120);
    expect(overtimeRateCentsPerHour(rules)).toBe(5_250);
    expect(price.cents).toBe(28_000 + 10_500);
  });

  it("rounds halves up, as every care value does", () => {
    // 1 minute at 3 cents an hour is 0.05 cents: below a half rounds down. 30 minutes at 1 cent is half a cent: up.
    expect(priceShift(at("08:00"), at("08:30"), { ...rules, rateCentsPerHour: 1 }).cents).toBe(1);
    expect(priceShift(at("08:00"), at("08:01"), { ...rules, rateCentsPerHour: 3 }).cents).toBe(0);
  });

  it("refuses a visit that never happened or ran past a day", () => {
    expect(() => priceShift(at("12:00"), at("08:00"), rules)).toThrow(ShiftPriceError);
    expect(() => priceShift(at("08:00"), at("08:00"), rules)).toThrow(ShiftPriceError);
    expect(() => priceShift(at("08:00"), new Date("2026-11-10T09:00:00Z"), rules)).toThrow(ShiftPriceError);
  });

  it("refuses rules that are not whole, positive numbers", () => {
    for (const bad of [{ rateCentsPerHour: 0 }, { rateCentsPerHour: 3_500.5 }, { overtimePercent: 99 }, { overtimeAfterMinutes: 0 }, { minimumMinutes: -1 }]) {
      expect(() => priceShift(at("08:00"), at("09:00"), { ...rules, ...bad })).toThrow(ShiftPriceError);
    }
  });

  it("never prices below the care valuation of the same minutes, and always in whole cents", () => {
    forAll(
      (random) => ({
        minutes: random.int(1, 1_440),
        rate: random.int(1, 20_000),
        minimum: random.int(0, 240),
        overtimeAfter: random.pick([null, 60, 240, 480] as const),
        percent: random.int(100, 300),
      }),
      ({ minutes, rate, minimum, overtimeAfter, percent }) => {
        const start = at("00:00");
        const end = new Date(start.getTime() + minutes * 60_000);
        const price = priceShift(start, end, { rateCentsPerHour: rate, minimumMinutes: minimum, overtimeAfterMinutes: overtimeAfter, overtimePercent: percent });
        expect(Number.isSafeInteger(price.cents)).toBe(true);
        expect(price.regularMinutes + price.overtimeMinutes).toBe(price.billableMinutes);
        expect(price.billableMinutes).toBeGreaterThanOrEqual(Math.max(minutes, minimum));
        expect(price.cents).toBe(price.regularCents + price.overtimeCents);
        // Overtime never pays less than the normal rate, so the total is at least the plain value.
        expect(price.cents).toBeGreaterThanOrEqual(careValueCents(price.billableMinutes, rate));
      },
    );
  });
});

const permission: ShiftPermission = {
  permissionId: "p1",
  payeeId: "amara",
  status: "active",
  maxMinutesPerDay: 240,
  perShiftCents: 15_000,
  validFrom: "2026-11-01",
  expiresOn: "2027-10-31",
};
const shift: ShiftToPay = { payeeId: "amara", day: "2026-11-09", billableMinutes: 240, cents: 14_000 };
const base: ShiftPermissionCandidate = { permission, today: "2026-11-09", circlePaused: false, minutesUsedThatDay: 0 };
const candidate = (change: Partial<ShiftPermissionCandidate>): ShiftPermissionCandidate => ({ ...base, ...change });

describe("checkShiftPermission", () => {
  it("covers the 140 dollar morning shift under 4 hours a day", () => {
    expect(checkShiftPermission(base, shift)).toBeNull();
  });

  it.each([
    ["a revoked permission", candidate({ permission: { ...permission, status: "revoked" } }), shift, "not_active"],
    ["a paused permission", candidate({ permission: { ...permission, status: "paused" } }), shift, "paused"],
    ["before it starts", candidate({ today: "2026-10-31" }), shift, "not_started"],
    ["after it expires", candidate({ today: "2027-11-01" }), shift, "expired"],
    ["a shift from before it began", base, { ...shift, day: "2026-10-30" }, "expired"],
    ["while the circle is paused", candidate({ circlePaused: true }), shift, "circle_paused"],
    ["another caregiver's shift", base, { ...shift, payeeId: "someone-else" }, "other_caregiver"],
    ["a shift above the per-shift cap", base, { ...shift, cents: 15_001 }, "above_per_shift"],
    ["a fifth hour in the same day", candidate({ minutesUsedThatDay: 60 }), shift, "over_daily_hours"],
  ] as const)("refuses %s", (_name, check, aShift, reason) => {
    expect(checkShiftPermission(check, aShift)).toBe(reason);
  });

  it("refuses an amount that is not whole cents", () => {
    expect(() => checkShiftPermission(base, { ...shift, cents: 140.5 })).toThrow();
  });

  it("never lets a day's paid minutes pass its cap, whatever the order of shifts", () => {
    let used = 0;
    for (const minutes of [90, 90, 90, 90, 60, 30]) {
      const refusal = checkShiftPermission(candidate({ minutesUsedThatDay: used }), { ...shift, billableMinutes: minutes, cents: 1_000 });
      if (refusal === null) used += minutes;
      expect(used).toBeLessThanOrEqual(240);
    }
    expect(used).toBe(240);
  });
});

describe("decideShiftPermission", () => {
  it("returns null with no live permission for the caregiver", () => {
    expect(decideShiftPermission([], shift)).toBeNull();
    expect(decideShiftPermission([candidate({ permission: { ...permission, status: "revoked" } })], shift)).toBeNull();
    expect(decideShiftPermission([candidate({ permission: { ...permission, payeeId: "someone-else" } })], shift)).toBeNull();
  });

  it("covers a shift the first fitting permission allows", () => {
    expect(decideShiftPermission([base], shift)).toEqual({ outcome: "covered", permissionId: "p1" });
  });

  it("asks the family and says why the nearest permission did not fit", () => {
    expect(decideShiftPermission([candidate({ minutesUsedThatDay: 120 })], shift)).toEqual({ outcome: "ask_family", permissionId: "p1", reason: "over_daily_hours" });
  });
});

describe("checkShiftPermissionTerms", () => {
  const terms = { payeeId: "amara", maxMinutesPerDay: 240, perShiftCents: 15_000, validFrom: "2026-11-01", expiresOn: "2027-10-31" };

  it("accepts terms inside the ceiling", () => {
    expect(() => checkShiftPermissionTerms(terms, 50_000)).not.toThrow();
  });

  it.each([
    ["no money", { perShiftCents: 0 }, "not_money"],
    ["no hours", { maxMinutesPerDay: 0 }, "bad_minutes"],
    ["more than a day", { maxMinutesPerDay: 1_441 }, "bad_minutes"],
    ["a cap above the ceiling", { perShiftCents: 60_000 }, "above_ceiling"],
    ["dates backwards", { expiresOn: "2026-10-01" }, "bad_dates"],
    ["a date that is not one", { validFrom: "yesterday" }, "bad_dates"],
    ["more than a year", { expiresOn: "2028-01-01" }, "too_long"],
  ] as const)("refuses %s", (_name, change, reason) => {
    try {
      checkShiftPermissionTerms({ ...terms, ...change }, 50_000);
      throw new Error("not refused");
    } catch (error) {
      expect(error).toBeInstanceOf(ShiftPermissionTermsError);
      expect((error as ShiftPermissionTermsError).reason).toBe(reason);
    }
  });
});

describe("mayConfirmShift", () => {
  const request = { role: "parent", memberId: "rose", shiftMemberId: "amara", parentDecides: true, demo: false } as const;

  it("always counts the parent's word", () => {
    expect(mayConfirmShift(request)).toBeNull();
  });

  it("never lets anyone confirm their own shift", () => {
    expect(mayConfirmShift({ ...request, role: "caregiver", memberId: "amara" })).toBe("own_shift");
    expect(mayConfirmShift({ ...request, role: "contributor", memberId: "amara" })).toBe("own_shift");
  });

  it("never lets a caregiver or an observer give the family's word", () => {
    expect(mayConfirmShift({ ...request, role: "caregiver", memberId: "bea" })).toBe("role_cannot");
    expect(mayConfirmShift({ ...request, role: "observer", memberId: "cy" })).toBe("role_cannot");
  });

  it("lets a sibling confirm only where the parent cannot", () => {
    expect(mayConfirmShift({ ...request, role: "contributor", memberId: "ana" })).toBe("parent_can_answer");
    expect(mayConfirmShift({ ...request, role: "contributor", memberId: "ana", parentDecides: false })).toBeNull();
    expect(mayConfirmShift({ ...request, role: "organizer", memberId: "marcus", demo: true })).toBeNull();
  });
});

describe("the circle's calendar", () => {
  it("puts a late evening instant on the circle's own day", () => {
    expect(shiftDay(new Date("2026-11-10T03:30:00Z"), "America/New_York")).toBe("2026-11-09");
    expect(shiftDay(new Date("2026-11-10T03:30:00Z"), "Europe/Paris")).toBe("2026-11-10");
  });

  it("names the part of the day on the circle's clock", () => {
    expect(dayPart(new Date("2026-11-09T14:00:00Z"), "America/New_York")).toBe("morning");
    expect(dayPart(new Date("2026-11-09T19:00:00Z"), "America/New_York")).toBe("afternoon");
    expect(dayPart(new Date("2026-11-10T01:00:00Z"), "America/New_York")).toBe("evening");
  });
});
