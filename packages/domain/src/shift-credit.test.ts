import { describe, expect, it } from "vitest";

import { careValueCents } from "./care.ts";
import { SHIFT_KINDS, ShiftPriceError, workedMinutes } from "./shift.ts";
import { CIRCLE_ROLES } from "./roles.ts";
import { isCreditedKind, valueCreditedShift } from "./shift-credit.ts";
import { forAll } from "./testing/index.ts";

const at = (time: string): Date => new Date(`2026-11-09T${time}:00Z`);

describe("which shifts are credited as care time", () => {
  it("credits a visit or a drive by a member who shares the cost, and nothing else", () => {
    const credited = SHIFT_KINDS.flatMap((kind) => CIRCLE_ROLES.filter((role) => isCreditedKind(kind, role)).map((role) => `${kind}:${role}`));
    expect(credited.sort()).toEqual(["drive:contributor", "drive:organizer", "visit:contributor", "visit:organizer"]);
  });
});

describe("what a credited visit is worth", () => {
  it("values the whole minutes between the taps at the care rate, halves rounded up", () => {
    // 45 minutes at 20.00 an hour.
    expect(valueCreditedShift(at("10:00"), at("10:45"), 2_000)).toEqual({ minutes: 45, cents: 1_500 });
    // 7 minutes at 20.01 is 2.3345: rounded to the cent.
    expect(valueCreditedShift(at("10:00"), at("10:07"), 2_001)).toEqual({ minutes: 7, cents: careValueCents(7, 2_001) });
  });

  it("does not credit a partial minute", () => {
    const start = at("10:00");
    expect(valueCreditedShift(start, new Date(start.getTime() + 119_999), 2_000).minutes).toBe(1);
  });

  it("refuses a visit under a minute or over a day, and a rate that cannot be applied", () => {
    expect(() => valueCreditedShift(at("10:00"), at("10:00"), 2_000)).toThrow(ShiftPriceError);
    expect(() => valueCreditedShift(at("00:00"), new Date(at("00:00").getTime() + 1_441 * 60_000), 2_000)).toThrow(ShiftPriceError);
    expect(() => valueCreditedShift(at("10:00"), at("11:00"), 1.5)).toThrow();
  });

  it("never credits more minutes than were worked, and the value is an exact integer", () => {
    forAll(
      (random) => ({ seconds: random.int(60, 1_440 * 60), rate: random.int(0, 20_000) }),
      ({ seconds, rate }) => {
        const start = at("00:00");
        const end = new Date(start.getTime() + seconds * 1_000);
        const credit = valueCreditedShift(start, end, rate);
        expect(credit.minutes).toBe(workedMinutes(start, end));
        expect(credit.minutes * 60).toBeLessThanOrEqual(seconds);
        expect(Number.isSafeInteger(credit.cents)).toBe(true);
        expect(credit.cents).toBe(careValueCents(credit.minutes, rate));
      },
    );
  });
});
