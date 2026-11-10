import { calendarDay } from "@kin/domain";
import type { CircleSnapshot, ProposalRecord } from "@kin/db";

import { periodSettlement } from "./fairness";

export type SettlementBasis = {
  /** The period the settlement closed, as YYYY-MM. */
  readonly period: string;
  /** The day the money core worked it out, as YYYY-MM-DD in the circle's timezone. */
  readonly calculatedOn: string;
  readonly memberId: string;
  /**
   * What the same period's fairness owes the member today, when the record
   * has moved since and it no longer matches the proposal; `null` while it does.
   */
  readonly nowOwedCents: number | null;
};

/**
 * What a waiting settlement payout was worked out from, and whether fairness
 * has moved since. The proposal keeps the amount the family is asked about;
 * this only says when it was calculated and what today's figure is.
 */
export function settlementBasis(circle: CircleSnapshot, proposal: ProposalRecord): SettlementBasis | null {
  if (proposal.kind !== "member_payout" || proposal.settlementId === null || !("memberId" in proposal.to)) return null;
  const settlement = circle.settlements.find((each) => each.id === proposal.settlementId);
  if (settlement === undefined) return null;
  const { memberId } = proposal.to;
  const today = periodSettlement(circle, settlement.period);
  const payout = today?.plan.payouts.find((each) => each.memberId === memberId);
  // A proposal raised for the whole amount owed, or for the part payable, still matches either.
  const matches = today === null || (payout !== undefined && (payout.cents === proposal.cents || payout.releasableCents === proposal.cents));
  return {
    period: settlement.period,
    calculatedOn: calendarDay(settlement.calculatedAt, circle.circle.timezone).occurredOn,
    memberId,
    nowOwedCents: matches ? null : (payout?.cents ?? 0),
  };
}
