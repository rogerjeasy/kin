import { POOL_CASH, describeAccount } from "./ledger-accounts.ts";
import { accountBalance, accountBalances, type Ledger } from "./ledger.ts";
import { sumCents } from "./money.ts";
import { SettlementError } from "./settlement.ts";

/**
 * The cash a settlement may pay out now: the pool's confirmed balance less
 * every approved bill not yet paid, never below zero. Money already promised
 * to a caregiver or a biller is not there to hand back to a member.
 */
export function cashAvailableForPayouts(ledger: Ledger): number {
  const poolCash = accountBalance(ledger, POOL_CASH);
  if (poolCash < 0) {
    // A pool cannot hold less than nothing, so the ledger behind it is wrong.
    throw new SettlementError(
      `The pool's confirmed balance cannot be below zero, got ${poolCash}`,
    );
  }
  return Math.max(0, poolCash - unpaidBills(ledger));
}

/**
 * Whether the pool can pay `cents` to a payee now, with PayPal's fee on top,
 * from money that has arrived (AGENTS.md section 5, rule 8). The bill being
 * paid is counted among the unpaid bills, so it is added back once.
 */
export function canPayOut(ledger: Ledger, payment: { readonly cents: number; readonly feeCents: number; readonly alreadyOwed: boolean }): boolean {
  const available = cashAvailableForPayouts(ledger) + (payment.alreadyOwed ? payment.cents : 0);
  return available >= sumCents([payment.cents, payment.feeCents]);
}

function unpaidBills(ledger: Ledger): number {
  return sumCents(
    [...accountBalances(ledger)]
      .filter(([account]) => describeAccount(account).family === "payable")
      // An overpaid payee is a problem for reconciliation. It frees no cash.
      .map(([, owed]) => Math.max(0, owed)),
  );
}
