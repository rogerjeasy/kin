import { REFILL_PRICE_CENTS, rosesMonth, settlePeriod, type Money } from "@kin/domain";

function usd(cents: number): Money {
  return { cents, currency: "USD" };
}

// The month-end figures come from the real settlement calculation run on
// Rose's month, so the pages can only show what the money core produces.
const { plan } = settlePeriod(rosesMonth);

function payoutTo(memberId: string): Money {
  const payout = plan.payouts.find((each) => each.memberId === memberId);
  if (!payout) {
    throw new Error(`Rose's month settles nothing to ${memberId}`);
  }
  return { cents: payout.cents, currency: plan.currency };
}

/**
 * Rose's family, from docs/project-description.md section 5. Every figure the
 * marketing pages show comes from here. None of it is a real transaction.
 */
export const exampleFamily = {
  purchaseLimit: usd(rosesMonth.agreement.approvals.parentDecidesAboveCents),
  electricityBill: usd(8400),
  gasBill: usd(5700),
  caregiverPay: usd(26400),
  refill: usd(REFILL_PRICE_CENTS),
  settlement: { elena: payoutTo("elena"), ana: payoutTo("ana") },
  shares: [
    { member: "marcus", percent: 50 },
    { member: "elena", percent: 30 },
    { member: "ana", percent: 20 },
  ],
} as const;

/**
 * What Kin reads back from PayPal before it records a payout as paid: the
 * payout batch's item, with this status (docs/architecture.md section 8.5).
 * Kin polls the batch; it does not subscribe to a payout-item webhook.
 */
export const PAYOUT_RECORD = "payout item: transaction_status SUCCESS";

export type Sibling = (typeof exampleFamily.shares)[number]["member"];

/** The example family's shares, named in the reader's language, for the share bar and legend. */
export function exampleShares(people: Readonly<Record<Sibling, string>>) {
  return exampleFamily.shares.map((share) => ({ key: share.member, name: people[share.member], bps: share.percent * 100 }));
}
