import { allocate } from "./allocate.ts";
import type { FairnessResult } from "./fairness.ts";
import { assertCents, sumCents } from "./money.ts";

/** A member who owes the pool is asked to pay this in. */
export type Collection = {
  readonly memberId: string;
  readonly cents: number;
};

/** A member the pool owes. */
export type Payout = {
  readonly memberId: string;
  readonly cents: number;
  /** The part the pool's confirmed balance can pay now. Never above `cents`. */
  readonly releasableCents: number;
};

export type SettlementPlan = {
  readonly currency: string;
  readonly collections: readonly Collection[];
  readonly payouts: readonly Payout[];
};

/** The plan cannot be drawn up safely. Retrying cannot help. */
export class SettlementError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "SettlementError";
  }
}

/**
 * Turns positions into the movements that restore the agreed shares. Money
 * moves through the pool, so the plan holds exactly one movement for each
 * member who is not already level, and no smaller set could close the gap.
 *
 * Payouts are released only as far as `poolAvailableCents` allows: the pool's
 * confirmed balance less unpaid bills, from `cashAvailableForPayouts`.
 * When it cannot cover them all, it is shared among them in proportion to what
 * each is owed, and the rest waits for the collections to arrive.
 */
export function planSettlement(
  fairness: FairnessResult,
  poolAvailableCents: number,
): SettlementPlan {
  const collections = fairness.positions
    .filter((position) => position.positionCents < 0)
    .map((position) => ({
      memberId: position.memberId,
      cents: -position.positionCents,
    }));
  const owed = fairness.positions
    .filter((position) => position.positionCents > 0)
    .map((position) => ({
      memberId: position.memberId,
      cents: position.positionCents,
    }));
  const releasable = releasableNow(
    owed.map((payout) => payout.cents),
    poolAvailableCents,
  );
  return {
    currency: fairness.currency,
    collections,
    payouts: owed.map((payout, index) => ({
      ...payout,
      // Safe: `releasableNow` returns one amount for each amount owed.
      releasableCents: releasable[index] as number,
    })),
  };
}

/**
 * How much of each amount owed the pool can pay from `poolAvailableCents`.
 * The amounts returned never total more than the pool holds.
 */
export function releasableNow(
  owedCents: readonly number[],
  poolAvailableCents: number,
): number[] {
  assertCents(poolAvailableCents);
  if (poolAvailableCents < 0) {
    // A pool cannot hold less than nothing, so the ledger behind it is wrong.
    throw new SettlementError(
      `The pool's confirmed balance cannot be below zero, got ${poolAvailableCents}`,
    );
  }
  if (owedCents.some((cents) => !Number.isSafeInteger(cents) || cents <= 0)) {
    throw new SettlementError(
      "An amount owed must be a whole number above zero",
    );
  }
  const totalOwed = sumCents(owedCents);
  return totalOwed <= poolAvailableCents
    ? [...owedCents]
    : allocate(poolAvailableCents, owedCents);
}
