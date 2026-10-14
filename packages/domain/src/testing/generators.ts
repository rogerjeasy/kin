import { BASIS_POINTS } from "../agreement.ts";
import type { FairnessInput } from "../fairness.ts";
import type { Random } from "./property.ts";

/** Large enough to stress exactness, small enough that sums stay exact. */
export const MAX_TEST_CENTS = 100_000_000_000_000;

/** `count` shares in whole basis points that total exactly 10,000. */
export function randomShares(random: Random, count: number): number[] {
  const cuts = Array.from({ length: count - 1 }, () =>
    random.int(0, BASIS_POINTS),
  ).toSorted((a, b) => a - b);
  const edges = [0, ...cuts, BASIS_POINTS];
  return edges.slice(1).map((edge, index) => edge - (edges[index] ?? 0));
}

/** An amount that is often small, sometimes zero and sometimes very large. */
export function randomCents(random: Random): number {
  const ceiling = random.pick([0, 99, 100_000, 10_000_000, MAX_TEST_CENTS]);
  return random.int(0, ceiling);
}

export function randomFairnessInput(random: Random): FairnessInput {
  const shares = randomShares(random, random.int(1, 8));
  return {
    currency: "USD",
    careCreditPaidInCash: random.int(0, 1) === 1,
    members: shares.map((shareBps, index) => ({
      memberId: `member-${index}`,
      shareBps,
      paidInCents: randomCents(random),
      outOfPocketCents: randomCents(random),
      careCreditCents: randomCents(random),
      carriedInCents: randomCents(random) - randomCents(random),
    })),
  };
}
