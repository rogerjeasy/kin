import { describe, expect, it } from "vitest";

import { POOL_CASH } from "./ledger-accounts.ts";
import { accountBalance, appendEntries, openLedger } from "./ledger.ts";
import { cashAvailableForPayouts } from "./payout-cash.ts";
import {
  billApproved,
  contributionReceived,
  payoutConfirmed,
  settlementPaidOut,
} from "./postings.ts";
import { SettlementError } from "./settlement.ts";
import {
  TEST_CIRCLE,
  TEST_CURRENCY,
  randomEntries,
  testHeader,
} from "./testing/entries.ts";
import { forAll } from "./testing/property.ts";

const funded = appendEntries(openLedger(TEST_CIRCLE, TEST_CURRENCY), [
  contributionReceived(testHeader("sale"), {
    memberId: "marcus",
    grossCents: 50000,
    feeCents: 0,
  }),
]);

const amaraBill = billApproved(testHeader("bill-amara"), {
  payeeId: "amara",
  category: "care",
  cents: 26400,
});

describe("cashAvailableForPayouts", () => {
  it("is the pool's cash when no bill is waiting", () => {
    expect(cashAvailableForPayouts(funded)).toBe(50000);
  });

  it("holds back what is owed on approved bills not yet paid", () => {
    const owing = appendEntries(funded, [amaraBill]);

    expect(cashAvailableForPayouts(owing)).toBe(50000 - 26400);
  });

  it("frees the cash once PayPal confirms the bill is paid", () => {
    const paid = appendEntries(funded, [
      amaraBill,
      payoutConfirmed(testHeader("payout-amara"), {
        payeeId: "amara",
        cents: 26400,
        feeCents: 0,
      }),
    ]);

    expect(cashAvailableForPayouts(paid)).toBe(50000 - 26400);
    expect(accountBalance(paid, POOL_CASH)).toBe(50000 - 26400);
  });

  it("is nothing when the bills waiting exceed the cash", () => {
    const short = appendEntries(funded, [
      billApproved(testHeader("bill-stairlift"), {
        payeeId: "stairlift",
        category: "repairs",
        cents: 90000,
      }),
    ]);

    expect(cashAvailableForPayouts(short)).toBe(0);
  });

  it("stops when the pool's cash is below zero, because the ledger is wrong", () => {
    const overdrawn = appendEntries(funded, [
      settlementPaidOut(testHeader("overpay"), {
        memberId: "elena",
        cents: 60000,
        feeCents: 0,
      }),
    ]);

    expect(() => cashAvailableForPayouts(overdrawn)).toThrow(SettlementError);
  });

  it("never offers more than the cash left after every unpaid bill", () => {
    forAll(randomEntries, (entries) => {
      const ledger = appendEntries(funded, entries);
      const cash = accountBalance(ledger, POOL_CASH);
      if (cash < 0) {
        return;
      }
      const unpaid = entries
        .flatMap((entry) => entry.lines)
        .filter((line) => line.account.startsWith("payable:"));
      const owed = new Map<string, number>();
      for (const line of unpaid) {
        const signed = line.direction === "credit" ? line.cents : -line.cents;
        owed.set(line.account, (owed.get(line.account) ?? 0) + signed);
      }
      const reserved = [...owed.values()].reduce(
        (sum, each) => sum + Math.max(0, each),
        0,
      );

      expect(cashAvailableForPayouts(ledger)).toBe(Math.max(0, cash - reserved));
    });
  });
});
