import { describe, expect, it } from "vitest";

import { CareValueError, careValueCents } from "./care.ts";

describe("careValueCents", () => {
  it("values whole hours at the family's rate", () => {
    expect(careValueCents(60, 2000)).toBe(2000);
    expect(careValueCents(720, 2200)).toBe(26400);
  });

  it("values part of an hour in proportion", () => {
    expect(careValueCents(45, 2000)).toBe(1500);
    expect(careValueCents(48, 2000)).toBe(1600);
  });

  it("rounds to the nearest cent, halves up", () => {
    // 1 minute at 19.99 an hour is 33.3166… cents.
    expect(careValueCents(1, 1999)).toBe(33);
    // 1 minute at 0.90 an hour is 1.5 cents.
    expect(careValueCents(1, 90)).toBe(2);
    // 1 minute at 0.89 an hour is 1.4833… cents.
    expect(careValueCents(1, 89)).toBe(1);
  });

  it("refuses time that is not a whole number of minutes above zero", () => {
    expect(() => careValueCents(0, 2000)).toThrow(CareValueError);
    expect(() => careValueCents(-30, 2000)).toThrow(CareValueError);
    expect(() => careValueCents(7.5, 2000)).toThrow(CareValueError);
  });

  it("refuses a rate that is not a whole number of cents", () => {
    expect(() => careValueCents(60, -1)).toThrow(CareValueError);
    expect(() => careValueCents(60, 19.99)).toThrow(CareValueError);
  });

  it("refuses a value too large to hold exactly", () => {
    expect(() =>
      careValueCents(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    ).toThrow(CareValueError);
  });
});
