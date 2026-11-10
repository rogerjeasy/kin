import { cashAvailableForPayouts, settlePeriod, type MemberContribution, type MemberPosition, type Settlement } from "@kin/domain";
import type { CircleSnapshot } from "@kin/db";
import { payoutFeeReserve } from "@kin/paypal";

export type MemberFairness = {
  readonly memberId: string;
  readonly shareBps: number;
  /** The member's place in the agreement's order of shares: their colour on every screen. */
  readonly shareIndex: number;
  readonly input: MemberContribution;
  readonly position: MemberPosition;
};

/**
 * The period's settlement, as the money core calculates it from the circle's
 * own ledger, with PayPal's payout fee reserved. `null` for a role that may
 * not see the agreement.
 */
export function periodSettlement(circle: CircleSnapshot, period: string): Settlement | null {
  if (circle.agreement === null) return null;
  return settlePeriod({ ledger: circle.ledger, agreement: circle.agreement, period, payoutFee: payoutFeeReserve(circle.circle.currency) });
}

/** Each sharing member's inputs and position, in the order of the agreement. */
export function memberFairness(settlement: Settlement, circle: CircleSnapshot): MemberFairness[] {
  const shares = circle.agreement?.shares ?? [];
  return shares.map((share, shareIndex) => {
    const input = settlement.inputs.members.find((member) => member.memberId === share.memberId);
    const position = settlement.fairness.positions.find((member) => member.memberId === share.memberId);
    if (!input || !position) {
      throw new Error(`The settlement holds no position for ${share.memberId}`);
    }
    return { memberId: share.memberId, shareBps: share.bps, shareIndex, input, position };
  });
}

type PlannedPayout = Settlement["plan"]["payouts"][number];

export type PayoutReason = {
  /** All of it can go now, part of it, part shared with others owed, or none yet. */
  readonly kind: "all" | "part" | "shared" | "none";
  /** The pool's confirmed cash less the bills it has promised, which the plan was bounded by. */
  readonly availableCents: number;
  /** What waits for more money to arrive. */
  readonly restCents: number;
};

/**
 * Why a payout can go now in full, in part or not yet, from the cash the
 * money core bounded the plan by. It explains the plan and decides nothing.
 */
export function payoutReason(circle: CircleSnapshot, settlement: Settlement, payout: PlannedPayout): PayoutReason {
  const availableCents = cashAvailableForPayouts(circle.ledger);
  // Both are whole cents and the part released is never above the amount owed, so the rest is whole and not below zero.
  const restCents = payout.cents - payout.releasableCents;
  const kind = restCents === 0 ? "all" : payout.releasableCents === 0 ? "none" : settlement.plan.payouts.length > 1 ? "shared" : "part";
  return { kind, availableCents, restCents };
}
