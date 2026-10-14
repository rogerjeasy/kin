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
  /** Cash held back for PayPal's fee on sending the whole amount. */
  readonly feeReservedCents: number;
  /** The part the pool can pay now. Never above `cents`. */
  readonly releasableCents: number;
};

/** The cash a settlement may draw on, and what sending a payout costs. */
export type PayoutFunds = {
  /** The pool's confirmed cash less unpaid bills, from `cashAvailableForPayouts`. */
  readonly availableCents: number;
  /**
   * The most PayPal charges to send a payout of `cents`. It must not fall as
   * the amount falls, so the fee on a partly released payout stays covered.
   */
  readonly payoutFee: (cents: number) => number;
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
 * Payouts are released only from the cash available after PayPal's fee for
 * each one is held back, so sending them cannot take the pool below zero.
 * When the rest cannot cover them all, it is shared among them in proportion
 * to what each is owed, and the remainder waits for the collections.
 */
export function planSettlement(
  fairness: FairnessResult,
  funds: PayoutFunds,
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
  assertPoolCash(funds.availableCents);
  const fees = owed.map((payout) => feeFor(funds, payout.cents));
  const afterFees = Math.max(0, funds.availableCents - sumCents(fees));
  const releasable = releasableNow(
    owed.map((payout) => payout.cents),
    afterFees,
  );
  return {
    currency: fairness.currency,
    collections,
    payouts: owed.map((payout, index) => ({
      ...payout,
      // Safe: `fees` and `releasable` hold one amount for each amount owed.
      feeReservedCents: fees[index] as number,
      releasableCents: releasable[index] as number,
    })),
  };
}

function feeFor(funds: PayoutFunds, cents: number): number {
  const fee = funds.payoutFee(cents);
  if (!Number.isSafeInteger(fee) || fee < 0) {
    throw new SettlementError(
      `A payout fee must be a whole number of cents, zero or more, got ${fee}`,
    );
  }
  return fee;
}

function assertPoolCash(cents: number): void {
  assertCents(cents);
  if (cents < 0) {
    // A pool cannot hold less than nothing, so the ledger behind it is wrong.
    throw new SettlementError(
      `The pool's confirmed balance cannot be below zero, got ${cents}`,
    );
  }
}

/**
 * How much of each amount owed the pool can pay from `poolAvailableCents`.
 * The amounts returned never total more than the pool holds.
 */
export function releasableNow(
  owedCents: readonly number[],
  poolAvailableCents: number,
): number[] {
  assertPoolCash(poolAvailableCents);
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
