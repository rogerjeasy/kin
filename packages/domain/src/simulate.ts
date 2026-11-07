import { BASIS_POINTS, type Agreement, type ApprovalTerms, type Share } from "./agreement.ts";
import { agreementChanges, type AgreementChange } from "./agreement-terms.ts";
import { allocate } from "./allocate.ts";
import { planApprovals, type ApprovalPlan } from "./approval-plan.ts";
import { FairnessError } from "./fairness.ts";
import { assertCents } from "./money.ts";
import { cashAvailableForPayouts } from "./payout-cash.ts";
import type { ParentLevel } from "./roles.ts";
import { settlePeriod, type Settlement, type SettlementQuery } from "./settle-period.ts";

/**
 * A change to try. Nothing here is saved: it is rehearsed against a copy of
 * the circle's real state by the same functions that run the real month.
 */
export type Scenario = {
  /** Replacement shares, whole basis points. Members left out keep their current share. */
  readonly shares?: readonly Share[];
  /** A member who stops sharing the cost: their share is spread over the rest in proportion. */
  readonly leavingMemberId?: string;
  /** Approval amounts to try in place of the agreement's. */
  readonly approvals?: ApprovalTerms;
  /** A bill, in cents, the pool would be asked to pay. */
  readonly billCents?: number;
};

export type ScenarioQuery = SettlementQuery & {
  readonly scenario: Scenario;
  readonly parentLevel: ParentLevel;
  readonly pausedUntil: Date | null;
  /** Passed in: a simulation never reads a clock. */
  readonly now: Date;
};

export type BillRehearsal = {
  readonly cents: number;
  /** Who must say yes, or why it is refused, under the hypothetical agreement. */
  readonly approval: ApprovalPlan;
  /** What the pool can spend now: confirmed cash less bills already promised. */
  readonly poolCents: number;
  /** What the pool lacks to pay the bill. Zero when it holds enough. */
  readonly shortfallCents: number;
  /** The shortfall shared out by the hypothetical shares, to the cent. */
  readonly topUps: readonly { readonly memberId: string; readonly cents: number }[];
};

export type ScenarioResult = {
  /** The month as it would close today. */
  readonly before: Settlement;
  /** The same month under the scenario. */
  readonly after: Settlement;
  readonly agreement: Agreement;
  /** What the scenario changes in the agreement, term by term. */
  readonly changes: readonly AgreementChange[];
  readonly bill: BillRehearsal | null;
};

/**
 * Rehearses a scenario: closes the period twice with the real settlement
 * code, once as things stand and once under the hypothetical agreement, and
 * runs the real approval engine on a hypothetical bill. Pure: it reads its
 * arguments only, writes nothing and moves no money. A scenario whose shares
 * do not total 10 000 is refused by the fairness calculation, as a real one.
 */
export function simulateScenario(query: ScenarioQuery): ScenarioResult {
  const { scenario, agreement } = query;
  const hypothetical = hypotheticalAgreement(agreement, scenario);
  const bill = scenario.billCents === undefined ? null : checkedBill(scenario.billCents);
  const before = settlePeriod(query);
  const after = settlePeriod({ ...query, agreement: hypothetical, heldBackCents: bill ?? 0 });
  return {
    before,
    after,
    agreement: hypothetical,
    changes: agreementChanges(agreement, { ...hypothetical, shares: hypothetical.shares.filter((share) => share.bps > 0) }),
    bill: bill === null ? null : rehearseBill(query, hypothetical, bill),
  };
}

function rehearseBill(query: ScenarioQuery, hypothetical: Agreement, cents: number): BillRehearsal {
  const poolCents = cashAvailableForPayouts(query.ledger);
  const shortfallCents = Math.max(0, cents - poolCents);
  const payers = hypothetical.shares.filter((share) => share.bps > 0);
  const parts = allocate(shortfallCents, payers.map((share) => share.bps));
  return {
    cents,
    approval: planApprovals({
      kind: "bill_payment",
      cents,
      payee: { status: "approved", member: null, autoPay: null },
      agreement: hypothetical,
      parentLevel: query.parentLevel,
      pausedUntil: query.pausedUntil,
      now: query.now,
    }),
    poolCents,
    shortfallCents,
    topUps: shortfallCents === 0 ? [] : payers.map((share, index) => ({ memberId: share.memberId, cents: parts[index] ?? 0 })),
  };
}

function hypotheticalAgreement(agreement: Agreement, scenario: Scenario): Agreement {
  let shares: readonly Share[] = agreement.shares;
  if (scenario.shares !== undefined) {
    const replaced = new Map(scenario.shares.map((share) => [share.memberId, share.bps]));
    shares = agreement.shares.map((share) => ({ memberId: share.memberId, bps: replaced.get(share.memberId) ?? share.bps }));
  }
  if (scenario.leavingMemberId !== undefined) shares = withoutMember(shares, scenario.leavingMemberId);
  return { ...agreement, shares, approvals: scenario.approvals ?? agreement.approvals };
}

// The leaver stays listed at zero so what they already gave this period is still
// placed; the rest are re-weighted by their own shares and still total 10 000.
function withoutMember(shares: readonly Share[], memberId: string): Share[] {
  if (!shares.some((share) => share.memberId === memberId)) throw new FairnessError(`Member "${memberId}" has no share to leave`);
  const staying = shares.filter((share) => share.memberId !== memberId && share.bps > 0);
  if (staying.length === 0) throw new FairnessError("Someone must remain to share the cost");
  const parts = allocate(BASIS_POINTS, staying.map((share) => share.bps));
  return shares.map((share) => {
    const index = staying.findIndex((each) => each.memberId === share.memberId);
    return { memberId: share.memberId, bps: index === -1 ? 0 : (parts[index] ?? 0) };
  });
}

function checkedBill(cents: number): number {
  assertCents(cents);
  if (cents <= 0) throw new FairnessError(`A bill must be above zero, got ${cents}`);
  return cents;
}
