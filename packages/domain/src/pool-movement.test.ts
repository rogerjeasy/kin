import { describe, expect, it } from "vitest";

import { InvalidMoneyError } from "./money.ts";
import { movementTotals, poolMovementCents, type MovementItem } from "./pool-movement.ts";

const item = (flow: MovementItem["flow"], cents: number): MovementItem => ({ flow, cents });

describe("poolMovementCents", () => {
  it("is positive for money in, negative for money out and zero for care time", () => {
    expect(poolMovementCents(item("in", 4_000))).toBe(4_000);
    expect(poolMovementCents(item("out", 4_000))).toBe(-4_000);
    expect(poolMovementCents(item("none", 4_000))).toBe(0);
  });
});

describe("movementTotals", () => {
  it("counts every entry but moves cash only for those that flow", () => {
    expect(movementTotals([item("in", 40_913), item("out", 12_600), item("none", 8_000), item("in", 5)])).toEqual({
      count: 4,
      inCents: 40_918,
      outCents: 12_600,
      netCents: 28_318,
    });
  });

  it("is zero for no entries", () => {
    expect(movementTotals([])).toEqual({ count: 0, inCents: 0, outCents: 0, netCents: 0 });
  });

  it("lets a reversal cancel the entry it reverses", () => {
    const totals = movementTotals([item("in", 7_550), item("out", 7_550)]);
    expect(totals.netCents).toBe(0);
    expect(totals.inCents).toBe(7_550);
    expect(totals.outCents).toBe(7_550);
  });

  it("goes negative when more left the pool than came in", () => {
    expect(movementTotals([item("in", 100), item("out", 350)]).netCents).toBe(-250);
  });

  it("is exact where floating-point sums drift", () => {
    const tenCents = Array.from({ length: 30 }, () => item("in", 10));
    expect(movementTotals(tenCents).netCents).toBe(300);
  });

  it("does not depend on the order of the entries", () => {
    const entries = [item("in", 101), item("out", 33), item("none", 9), item("in", 7), item("out", 2)];
    expect(movementTotals(entries.toReversed())).toEqual(movementTotals(entries));
  });

  it("refuses an amount that is not whole cents", () => {
    expect(() => movementTotals([item("in", 10.5)])).toThrow(InvalidMoneyError);
  });
});
