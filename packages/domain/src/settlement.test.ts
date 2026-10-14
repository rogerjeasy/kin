import { describe, expect, it } from "vitest";

import { calculateFairness, type FairnessResult } from "./fairness.ts";
import { InvalidMoneyError } from "./money.ts";
import {
  SettlementError,
  planSettlement,
  releasableNow,
} from "./settlement.ts";
import { randomCents, randomFairnessInput } from "./testing/generators.ts";
import { forAll } from "./testing/property.ts";

function fairnessOf(positions: Record<string, number>): FairnessResult {
  return {
    currency: "USD",
    totalContributedCents: 0,
    positions: Object.entries(positions).map(([memberId, positionCents]) => ({
      memberId,
      contributedCents: 0,
      targetCents: 0,
      cashDueCents: 0,
      unusedCareCreditCents: 0,
      positionCents,
    })),
  };
}

const total = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0);

describe("planSettlement", () => {
  const month = fairnessOf({ ana: 4000, elena: 12600, marcus: -16600 });

  it("asks members who owe to pay in and pays members who are owed", () => {
    expect(planSettlement(month, 38318)).toEqual({
      currency: "USD",
      collections: [{ memberId: "marcus", cents: 16600 }],
      payouts: [
        { memberId: "ana", cents: 4000, releasableCents: 4000 },
        { memberId: "elena", cents: 12600, releasableCents: 12600 },
      ],
    });
  });

  it("leaves a member who is level out of the plan", () => {
    const plan = planSettlement(fairnessOf({ a: 0, b: 500, c: -500 }), 500);

    expect(plan.collections).toEqual([{ memberId: "c", cents: 500 }]);
    expect(plan.payouts).toEqual([
      { memberId: "b", cents: 500, releasableCents: 500 },
    ]);
  });

  it("plans nothing when everyone is level", () => {
    expect(planSettlement(fairnessOf({ a: 0, b: 0 }), 0)).toEqual({
      currency: "USD",
      collections: [],
      payouts: [],
    });
  });

  it("releases nothing from an empty pool", () => {
    const plan = planSettlement(month, 0);

    expect(plan.payouts.map((payout) => payout.releasableCents)).toEqual([0, 0]);
  });

  it("shares a short pool in proportion to what each member is owed", () => {
    const plan = planSettlement(month, 8300);

    // Half of the 166.00 owed is there, so each payout is half released.
    expect(plan.payouts.map((payout) => payout.releasableCents)).toEqual([
      2000, 6300,
    ]);
  });

  it("refuses a pool balance that is below zero or not whole cents", () => {
    expect(() => planSettlement(month, -1)).toThrow(SettlementError);
    expect(() => planSettlement(month, 0.5)).toThrow(InvalidMoneyError);
  });
});

describe("releasableNow", () => {
  it("never splits a cent", () => {
    expect(releasableNow([1, 1, 1], 2)).toEqual([1, 1, 0]);
  });

  it("refuses an amount owed that is not above zero", () => {
    expect(() => releasableNow([100, 0], 50)).toThrow(SettlementError);
    expect(() => releasableNow([100, -5], 50)).toThrow(SettlementError);
  });
});

describe("for any positions and any pool balance", () => {
  const anyPlan = (random: Parameters<typeof randomFairnessInput>[0]) => ({
    input: randomFairnessInput(random),
    pool: randomCents(random),
  });

  it("a settlement never releases more than the pool holds", () => {
    forAll(anyPlan, ({ input, pool }) => {
      const { payouts } = planSettlement(calculateFairness(input), pool);
      const owed = total(payouts.map((payout) => payout.cents));
      const released = total(payouts.map((payout) => payout.releasableCents));

      expect(released).toBe(Math.min(pool, owed));
      for (const payout of payouts) {
        expect(payout.releasableCents).toBeGreaterThanOrEqual(0);
        expect(payout.releasableCents).toBeLessThanOrEqual(payout.cents);
      }
    });
  });

  it("the movements close every position exactly", () => {
    forAll(anyPlan, ({ input, pool }) => {
      const fairness = calculateFairness(input);
      const plan = planSettlement(fairness, pool);
      const moved = new Map<string, number>([
        ...plan.payouts.map((each) => [each.memberId, each.cents] as const),
        ...plan.collections.map((each) => [each.memberId, -each.cents] as const),
      ]);

      for (const position of fairness.positions) {
        expect(moved.get(position.memberId) ?? 0).toBe(position.positionCents);
      }
    });
  });

  it("the plan has one movement for each member who is not level", () => {
    forAll(anyPlan, ({ input, pool }) => {
      const fairness = calculateFairness(input);
      const plan = planSettlement(fairness, pool);
      const notLevel = fairness.positions.filter(
        (position) => position.positionCents !== 0,
      );

      expect(plan.collections.length + plan.payouts.length).toBe(
        notLevel.length,
      );
    });
  });
});
