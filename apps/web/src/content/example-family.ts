import { rosesMonth, settlePeriod, type Money } from "@kin/domain";

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
  purchaseLimit: usd(5000),
  electricityBill: usd(8400),
  gasBill: usd(5700),
  caregiverPay: usd(26400),
  refill: usd(4200),
  settlement: { elena: payoutTo("elena"), ana: payoutTo("ana") },
  shares: [
    { member: "marcus", percent: 50 },
    { member: "elena", percent: 30 },
    { member: "ana", percent: 20 },
  ],
} as const;

/**
 * The PayPal webhook that confirms money has left the pool for a payee
 * (docs/architecture.md section 8.2).
 */
export const PAYOUT_EVENT = "PAYMENT.PAYOUTS-ITEM.SUCCEEDED";

export type Sibling = (typeof exampleFamily.shares)[number]["member"];
