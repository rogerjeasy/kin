import { assertCents } from "./money.ts";

/** The total or the weights cannot be shared out. Retrying cannot help. */
export class AllocationError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "AllocationError";
  }
}

type Part = {
  readonly index: number;
  readonly whole: bigint;
  readonly remainder: bigint;
};

/**
 * Shares `totalCents` out in proportion to `weights` by the largest-remainder
 * method. The parts always add up to the total exactly.
 *
 * Each part first gets its share rounded down. The cents left over go one each
 * to the parts with the largest remainders. Parts with equal remainders are
 * served in the order they were given, so the caller fixes the order.
 */
export function allocate(
  totalCents: number,
  weights: readonly number[],
): number[] {
  assertCents(totalCents);
  if (totalCents < 0) {
    throw new AllocationError(
      `Cannot share out a negative total, got ${totalCents}`,
    );
  }
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new AllocationError(
        `A weight must be a whole number of zero or more, got ${weight}`,
      );
    }
  }
  const weightSum = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
  if (weightSum === 0n) {
    throw new AllocationError("At least one weight must be above zero");
  }

  // BigInt keeps total × weight exact for any amount a number can hold.
  const total = BigInt(totalCents);
  const parts: Part[] = weights.map((weight, index) => {
    const scaled = total * BigInt(weight);
    return { index, whole: scaled / weightSum, remainder: scaled % weightSum };
  });
  const shared = parts.reduce((sum, part) => sum + part.whole, 0n);
  const leftover = Number(total - shared);
  const raised = new Set(
    parts
      .toSorted(byLargestRemainder)
      .slice(0, leftover)
      .map((part) => part.index),
  );
  return parts.map((part) => Number(part.whole) + (raised.has(part.index) ? 1 : 0));
}

function byLargestRemainder(a: Part, b: Part): number {
  if (a.remainder !== b.remainder) {
    return a.remainder > b.remainder ? -1 : 1;
  }
  return a.index - b.index;
}
