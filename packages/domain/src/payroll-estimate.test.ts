import { describe, expect, it } from "vitest";

import { bpsOf, estimateHouseholdTax, quarterOf } from "./payroll-estimate.ts";
import { forAll } from "./testing/index.ts";

describe("the household-employer estimate", () => {
  it("owes nothing under the 2026 threshold", () => {
    const estimate = estimateHouseholdTax({ employee: "Maya", year: 2026, quarterCents: [100_000, 100_000, 99_999, 0] });
    expect(estimate.aboveThreshold).toBe(false);
    expect(estimate.socialSecurityCents + estimate.medicareCents).toBe(0);
    // A quarter of $1 000 starts the federal unemployment tax even under the threshold: 0.6% of $2 999.99.
    expect(estimate.futaCents).toBe(1_800);
  });

  it("charges both shares of Social Security and Medicare on every cent once the threshold is reached", () => {
    const estimate = estimateHouseholdTax({ employee: "Maya", year: 2026, quarterCents: [300_000, 0, 0, 0] });
    expect(estimate.aboveThreshold).toBe(true);
    expect(estimate.socialSecurityCents).toBe(37_200);
    expect(estimate.medicareCents).toBe(8_700);
    expect(estimate.futaCents).toBe(1_800);
    expect(estimate.totalCents).toBe(47_700);
  });

  it("caps Social Security at the wage base and the unemployment tax at $7 000", () => {
    const estimate = estimateHouseholdTax({ employee: "Maya", year: 2026, quarterCents: [10_000_000, 10_000_000, 0, 0] });
    expect(estimate.socialSecurityCents).toBe(Number((18_450_000n * 1240n) / 10000n));
    expect(estimate.futaCents).toBe(4_200);
  });

  it("says plainly when it has no table for the year", () => {
    const estimate = estimateHouseholdTax({ employee: "Maya", year: 2021, quarterCents: [500_000, 0, 0, 0] });
    expect(estimate.known).toBe(false);
    expect(estimate.totalCents).toBe(0);
    expect(estimate.wagesCents).toBe(500_000);
  });

  it("rounds half up in integers and puts January to March in the first quarter", () => {
    expect(bpsOf(5, 1000)).toBe(1);
    expect(bpsOf(4, 1000)).toBe(0);
    expect(quarterOf("2026-03-31")).toBe(0);
    expect(quarterOf("2026-04-01")).toBe(1);
    expect(quarterOf("2026-12-31")).toBe(3);
  });

  it("never returns a fraction of a cent, whatever was paid", () => {
    forAll(
      (random) => ({ employee: "x", year: 2026, quarterCents: [random.int(0, 9_000_000), random.int(0, 9_000_000), random.int(0, 9_000_000), random.int(0, 9_000_000)] as [number, number, number, number] }),
      (input) => {
        const estimate = estimateHouseholdTax(input);
        for (const cents of [estimate.socialSecurityCents, estimate.medicareCents, estimate.futaCents, estimate.totalCents]) expect(Number.isSafeInteger(cents)).toBe(true);
        expect(estimate.totalCents).toBe(estimate.socialSecurityCents + estimate.medicareCents + estimate.futaCents);
      },
    );
  });
});
