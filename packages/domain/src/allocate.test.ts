import { describe, expect, it } from "vitest";

import { AllocationError, allocate } from "./allocate.ts";
import { InvalidMoneyError } from "./money.ts";
import { MAX_TEST_CENTS, randomShares } from "./testing/generators.ts";
import { forAll } from "./testing/property.ts";

describe("allocate", () => {
  it("shares a total in proportion to the weights", () => {
    expect(allocate(118000, [5000, 3000, 2000])).toEqual([59000, 35400, 23600]);
  });

  it("gives the leftover cent to the largest remainder", () => {
    // 100 × 1/3 leaves 1/3 of a cent, 100 × 2/3 leaves 2/3.
    expect(allocate(100, [1, 2])).toEqual([33, 67]);
  });

  it("serves equal remainders in the order given", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(101, [1, 1, 1])).toEqual([34, 34, 33]);
  });

  it("gives a zero weight nothing", () => {
    expect(allocate(1, [0, 1, 0])).toEqual([0, 1, 0]);
  });

  it("stays exact at the largest amount a number can hold", () => {
    expect(allocate(Number.MAX_SAFE_INTEGER, [3333, 3333, 3334])).toEqual([
      3002099511605172, 3002099511605172, 3003000231530647,
    ]);
  });

  it("refuses a fractional or negative total", () => {
    expect(() => allocate(10.5, [1])).toThrow(InvalidMoneyError);
    expect(() => allocate(-1, [1])).toThrow(AllocationError);
  });

  it("refuses weights that cannot share anything out", () => {
    expect(() => allocate(100, [])).toThrow(AllocationError);
    expect(() => allocate(100, [0, 0])).toThrow(AllocationError);
    expect(() => allocate(100, [1, -1])).toThrow(AllocationError);
    expect(() => allocate(100, [0.5, 0.5])).toThrow(AllocationError);
  });

  it("never creates or loses a cent, for any total and weights", () => {
    forAll(
      (random) => ({
        total: random.int(0, MAX_TEST_CENTS),
        weights: randomShares(random, random.int(1, 12)),
      }),
      ({ total, weights }) => {
        const parts = allocate(total, weights);
        expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total);
      },
    );
  });

  it("keeps every part within one cent of its exact share", () => {
    forAll(
      (random) => ({
        total: random.int(0, MAX_TEST_CENTS),
        weights: randomShares(random, random.int(1, 12)),
      }),
      ({ total, weights }) => {
        const weightSum = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
        allocate(total, weights).forEach((part, index) => {
          const exact = BigInt(total) * BigInt(weights[index] ?? 0);
          const distance = BigInt(part) * weightSum - exact;
          expect(distance > -weightSum && distance < weightSum).toBe(true);
        });
      },
    );
  });
});
