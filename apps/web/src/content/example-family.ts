import type { Money } from "@kin/domain";

function usd(cents: number): Money {
  return { cents, currency: "USD" };
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
  settlement: { elena: usd(12600), ana: usd(4000) },
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
