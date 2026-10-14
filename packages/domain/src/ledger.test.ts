import { describe, expect, it } from "vitest";

import { describeAccount } from "./ledger-accounts.ts";
import { reverseEntry, type LedgerEntry } from "./ledger-entry.ts";
import { LedgerError } from "./ledger-error.ts";
import {
  accountBalance,
  accountBalances,
  appendEntries,
  appendEntry,
  openLedger,
  type Ledger,
} from "./ledger.ts";
import {
  billApproved,
  contributionReceived,
  payoutConfirmed,
} from "./postings.ts";
import {
  TEST_CIRCLE,
  TEST_CURRENCY,
  randomEntries,
  testHeader,
} from "./testing/entries.ts";
import { forAll } from "./testing/property.ts";

const empty = openLedger(TEST_CIRCLE, TEST_CURRENCY);

const contribution = contributionReceived(testHeader("sale-1"), {
  memberId: "marcus",
  grossCents: 20000,
  feeCents: 728,
});

function reversalOf(original: LedgerEntry, name: string): LedgerEntry {
  return reverseEntry(original, {
    id: `entry-${name}`,
    occurredOn: original.occurredOn,
    period: original.period,
    description: `Reversal of ${original.description}`,
    source: { type: "paypal_event", id: name },
  });
}

function refusal(build: () => unknown): string {
  try {
    build();
  } catch (error) {
    if (error instanceof LedgerError) {
      return error.reason;
    }
    throw error;
  }
  return "accepted";
}

/** Debit-side balances minus credit-side balances. Zero in a sound ledger. */
function imbalance(ledger: Ledger, memo: boolean): number {
  let total = 0;
  for (const [account, balance] of accountBalances(ledger)) {
    const details = describeAccount(account);
    if ((details.type === "memo") === memo) {
      total += details.normal === "debit" ? balance : -balance;
    }
  }
  return total;
}

describe("appendEntry", () => {
  it("adds an entry and leaves the earlier ledger untouched", () => {
    const { ledger, applied } = appendEntry(empty, contribution);

    expect(applied).toBe(true);
    expect(ledger.entries).toEqual([contribution]);
    expect(empty.entries).toEqual([]);
    expect(Object.isFrozen(ledger.entries)).toBe(true);
  });

  it("changes nothing when the same event is applied twice", () => {
    const once = appendEntry(empty, contribution).ledger;
    const twice = appendEntry(once, contribution);

    expect(twice.applied).toBe(false);
    expect(twice.ledger).toBe(once);
  });

  it("refuses a different entry that claims a recorded source", () => {
    const once = appendEntry(empty, contribution).ledger;
    const altered = contributionReceived(testHeader("sale-1"), {
      memberId: "marcus",
      grossCents: 90000,
      feeCents: 728,
    });

    expect(refusal(() => appendEntry(once, altered))).toBe("source_conflict");
  });

  it("refuses a second entry with a used ID", () => {
    const once = appendEntry(empty, contribution).ledger;
    const sameId = contributionReceived(
      testHeader("sale-2", { id: contribution.id }),
      { memberId: "elena", grossCents: 12000, feeCents: 0 },
    );

    expect(refusal(() => appendEntry(once, sameId))).toBe("duplicate_id");
  });

  it("refuses an entry from another circle or in another currency", () => {
    const stranger = contributionReceived(
      testHeader("sale-3", { circleId: "circle-2" }),
      { memberId: "marcus", grossCents: 20000, feeCents: 0 },
    );
    const euros = contributionReceived(
      testHeader("sale-4", { currency: "EUR" }),
      { memberId: "marcus", grossCents: 20000, feeCents: 0 },
    );

    expect(refusal(() => appendEntry(empty, stranger))).toBe("wrong_circle");
    expect(refusal(() => appendEntry(empty, euros))).toBe("wrong_currency");
  });

  it("refuses an entry that was tampered with after it was built", () => {
    const tampered = {
      ...contribution,
      lines: contribution.lines.slice(0, 2),
    };

    expect(refusal(() => appendEntry(empty, tampered))).toBe("unbalanced");
  });
});

describe("a reversal", () => {
  const recorded = appendEntry(empty, contribution).ledger;

  it("cancels the original without removing it", () => {
    const reversal = reversalOf(contribution, "refund-1");
    const ledger = appendEntry(recorded, reversal).ledger;

    expect(ledger.entries).toEqual([contribution, reversal]);
    expect(accountBalance(ledger, "pool_cash")).toBe(0);
    expect(accountBalance(ledger, "fees")).toBe(0);
    expect(accountBalance(ledger, "member:marcus")).toBe(0);
  });

  it("is refused when its original is not in the ledger", () => {
    const reversal = reversalOf(contribution, "refund-1");

    expect(refusal(() => appendEntry(empty, reversal))).toBe("invalid_reversal");
  });

  it("is refused when the original is already reversed", () => {
    const once = appendEntry(recorded, reversalOf(contribution, "refund-1")).ledger;
    const again = reversalOf(contribution, "refund-2");

    expect(refusal(() => appendEntry(once, again))).toBe("invalid_reversal");
  });

  it("cannot itself be reversed", () => {
    const reversal = reversalOf(contribution, "refund-1");
    const once = appendEntry(recorded, reversal).ledger;
    const undo = reversalOf(reversal, "undo-1");

    expect(refusal(() => appendEntry(once, undo))).toBe("invalid_reversal");
  });

  it("is refused when it does not mirror its original", () => {
    const partial = {
      ...contributionReceived(testHeader("refund-1"), {
        memberId: "marcus",
        grossCents: 5000,
        feeCents: 0,
      }),
      reverses: contribution.id,
    };

    expect(refusal(() => appendEntry(recorded, partial))).toBe("invalid_reversal");
  });
});

describe("accountBalance", () => {
  it("counts each account on the side where it grows", () => {
    const ledger = appendEntries(empty, [
      contribution,
      billApproved(testHeader("bill-1"), {
        payeeId: "amara",
        category: "care",
        cents: 26400,
      }),
      payoutConfirmed(testHeader("payout-1"), {
        payeeId: "amara",
        cents: 10000,
        feeCents: 25,
      }),
    ]);

    // 192.72 in, 100.00 paid out and 0.25 to send it.
    expect(accountBalance(ledger, "pool_cash")).toBe(9247);
    expect(accountBalance(ledger, "fees")).toBe(753);
    expect(accountBalance(ledger, "member:marcus")).toBe(20000);
    expect(accountBalance(ledger, "expense:care")).toBe(26400);
    expect(accountBalance(ledger, "payable:amara")).toBe(16400);
    expect(accountBalance(ledger, "member:elena")).toBe(0);
  });
});

describe("for any sequence of entries", () => {
  it("the ledger balances, with cash and care credit each balancing alone", () => {
    forAll(randomEntries, (entries) => {
      const ledger = appendEntries(empty, entries);

      expect(imbalance(ledger, false)).toBe(0);
      expect(imbalance(ledger, true)).toBe(0);
    });
  });

  it("applying every event a second time changes nothing", () => {
    forAll(randomEntries, (entries) => {
      const once = appendEntries(empty, entries);
      const twice = appendEntries(once, entries);

      expect(twice).toBe(once);
      expect(twice.entries).toHaveLength(entries.length);
    });
  });

  it("reversing every entry returns every balance to zero", () => {
    forAll(randomEntries, (entries) => {
      const reversals = entries.map((entry, index) =>
        reversalOf(entry, `reversal-${index}`),
      );
      const ledger = appendEntries(empty, [...entries, ...reversals]);

      expect(ledger.entries).toHaveLength(entries.length * 2);
      for (const balance of accountBalances(ledger).values()) {
        expect(balance).toBe(0);
      }
    });
  });
});
