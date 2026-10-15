import { settlePeriod, type MemberContribution, type MemberPosition, type Settlement } from "@kin/domain";
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
