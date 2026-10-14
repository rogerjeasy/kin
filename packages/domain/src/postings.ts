import { careValueCents } from "./care.ts";
import {
  CARE_RECEIVED,
  FEES,
  POOL_CASH,
  careCreditAccount,
  expenseAccount,
  memberAccount,
  payableAccount,
  type AccountCode,
} from "./ledger-accounts.ts";
import {
  createEntry,
  credit,
  debit,
  type EntryHeader,
  type LedgerEntry,
  type LedgerLine,
} from "./ledger-entry.ts";
import { sumCents } from "./money.ts";

/**
 * The ledger entry for each kind of financial fact, from the table in
 * docs/architecture.md section 7.1. Callers state what happened. Which
 * accounts move is decided here and nowhere else.
 */

type MoneyIn = {
  readonly memberId: string;
  /** What the member paid. The member is credited with all of it. */
  readonly grossCents: number;
  /** PayPal's fee, a cost the whole circle shares. */
  readonly feeCents: number;
};

/** A member's contribution has arrived in the pool. */
export function contributionReceived(
  header: EntryHeader,
  payment: MoneyIn,
): LedgerEntry {
  return createEntry({
    ...header,
    kind: "contribution",
    lines: moneyIn(payment),
  });
}

/** A member has paid what a settlement asked of them. */
export function settlementCollected(
  header: EntryHeader,
  payment: MoneyIn,
): LedgerEntry {
  return createEntry({
    ...header,
    kind: "settlement_collection",
    lines: moneyIn(payment),
  });
}

/** A member's receipt for money spent from their own pocket is approved. */
export function outOfPocketApproved(
  header: EntryHeader,
  receipt: {
    readonly memberId: string;
    readonly category: string;
    readonly cents: number;
  },
): LedgerEntry {
  return createEntry({
    ...header,
    kind: "out_of_pocket",
    lines: [
      debit(expenseAccount(receipt.category), receipt.cents),
      credit(memberAccount(receipt.memberId), receipt.cents),
    ],
  });
}

/** A payee's bill is approved and waits to be paid. */
export function billApproved(
  header: EntryHeader,
  bill: {
    readonly payeeId: string;
    readonly category: string;
    readonly cents: number;
  },
): LedgerEntry {
  return createEntry({
    ...header,
    kind: "bill_approved",
    lines: [
      debit(expenseAccount(bill.category), bill.cents),
      credit(payableAccount(bill.payeeId), bill.cents),
    ],
  });
}

type MoneyOut = {
  /** What the payee received. */
  readonly cents: number;
  /**
   * PayPal's fee for sending it, read from the payout item. The pool pays it
   * on top, and the whole circle shares it.
   */
  readonly feeCents: number;
};

/** PayPal confirms that a payee has been paid from the pool. */
export function payoutConfirmed(
  header: EntryHeader,
  payout: MoneyOut & { readonly payeeId: string },
): LedgerEntry {
  return createEntry({
    ...header,
    kind: "payout_confirmed",
    lines: moneyOut(payableAccount(payout.payeeId), payout),
  });
}

/** A purchase for the parent is captured from the pool. */
export function purchaseCaptured(
  header: EntryHeader,
  purchase: { readonly category: string; readonly cents: number },
): LedgerEntry {
  return createEntry({
    ...header,
    kind: "purchase_captured",
    lines: [
      debit(expenseAccount(purchase.category), purchase.cents),
      credit(POOL_CASH, purchase.cents),
    ],
  });
}

/** PayPal confirms that a settlement has paid a member what they were owed. */
export function settlementPaidOut(
  header: EntryHeader,
  payout: MoneyOut & { readonly memberId: string },
): LedgerEntry {
  return createEntry({
    ...header,
    kind: "settlement_payout",
    lines: moneyOut(memberAccount(payout.memberId), payout),
  });
}

/**
 * A member's hands-on care is approved and valued at the family's rate. The
 * entry touches memo accounts only, so care never appears as cash.
 */
export function careCreditLogged(
  header: EntryHeader,
  care: {
    readonly memberId: string;
    readonly minutes: number;
    readonly rateCentsPerHour: number;
  },
): LedgerEntry {
  const cents = careValueCents(care.minutes, care.rateCentsPerHour);
  return createEntry({
    ...header,
    kind: "care_credit",
    lines: [
      debit(CARE_RECEIVED, cents),
      credit(careCreditAccount(care.memberId), cents),
    ],
  });
}

function moneyIn(payment: MoneyIn): LedgerLine[] {
  const lines = [
    debit(POOL_CASH, payment.grossCents - payment.feeCents),
    credit(memberAccount(payment.memberId), payment.grossCents),
  ];
  return payment.feeCents === 0
    ? lines
    : [...lines, debit(FEES, payment.feeCents)];
}

function moneyOut(account: AccountCode, payout: MoneyOut): LedgerLine[] {
  const lines = [
    debit(account, payout.cents),
    credit(POOL_CASH, sumCents([payout.cents, payout.feeCents])),
  ];
  return payout.feeCents === 0 ? lines : [...lines, debit(FEES, payout.feeCents)];
}
