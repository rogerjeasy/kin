import { rosesMonth, settlePeriod, type MemberContribution, type MemberPosition, type Settlement } from "@kin/domain";

import type { Sibling } from "../example-family";

export type MemberFairness = {
  readonly memberId: Sibling;
  readonly shareBps: number;
  readonly input: MemberContribution;
  readonly position: MemberPosition;
};

/** The month's settlement, as the money core calculates it. */
export function monthSettlement(): Settlement {
  return settlePeriod(rosesMonth);
}

/** Each sibling's inputs and position, in the order of the agreement. */
export function memberFairness(settlement: Settlement = monthSettlement()): MemberFairness[] {
  return rosesMonth.agreement.shares.map((share) => {
    const input = settlement.inputs.members.find((member) => member.memberId === share.memberId);
    const position = settlement.fairness.positions.find((member) => member.memberId === share.memberId);
    if (!input || !position) {
      throw new Error(`The settlement holds no position for ${share.memberId}`);
    }
    // Safe: the agreement's shares belong to the three siblings.
    return { memberId: share.memberId as Sibling, shareBps: share.bps, input, position };
  });
}
