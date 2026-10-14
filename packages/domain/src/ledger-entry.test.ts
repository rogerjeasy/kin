import { describe, expect, it } from "vitest";

import { describeAccount } from "./ledger-accounts.ts";
import {
  createEntry,
  credit,
  debit,
  reverseEntry,
  type LedgerEntry,
} from "./ledger-entry.ts";
import { LedgerError, type LedgerErrorReason } from "./ledger-error.ts";
import { InvalidMoneyError } from "./money.ts";
import { randomEntries, testHeader } from "./testing/entries.ts";
import { forAll } from "./testing/property.ts";

function refusal(build: () => unknown): LedgerErrorReason | "accepted" {
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

function sideTotal(entry: LedgerEntry, direction: "debit" | "credit"): number {
  return entry.lines
    .filter((line) => line.direction === direction)
    .reduce((sum, line) => sum + line.cents, 0);
}

const draft = {
  ...testHeader("sale-1"),
  kind: "contribution",
  lines: [
    debit("pool_cash", 19272),
    debit("fees", 728),
    credit("member:marcus", 20000),
  ],
} as const;

describe("createEntry", () => {
  it("accepts an entry whose debits equal its credits", () => {
    const entry = createEntry(draft);
    expect(entry.reverses).toBeNull();
    expect(sideTotal(entry, "debit")).toBe(20000);
    expect(sideTotal(entry, "credit")).toBe(20000);
  });

  it("refuses an entry that does not balance", () => {
    const lines = [debit("pool_cash", 20000), credit("member:marcus", 19999)];
    expect(refusal(() => createEntry({ ...draft, lines }))).toBe("unbalanced");
  });

  it("refuses an entry with fewer than two lines", () => {
    const lines = [debit("pool_cash", 20000)];
    expect(refusal(() => createEntry({ ...draft, lines }))).toBe("invalid_entry");
  });

  it("refuses a line that is zero or negative", () => {
    const zero = [debit("pool_cash", 0), credit("member:marcus", 0)];
    const negative = [debit("pool_cash", -500), credit("member:marcus", -500)];
    expect(refusal(() => createEntry({ ...draft, lines: zero }))).toBe("invalid_entry");
    expect(refusal(() => createEntry({ ...draft, lines: negative }))).toBe("invalid_entry");
  });

  it("refuses a fraction of a cent", () => {
    const lines = [debit("pool_cash", 100.5), credit("member:marcus", 100.5)];
    expect(() => createEntry({ ...draft, lines })).toThrow(InvalidMoneyError);
  });

  it("refuses an entry that mixes care credit with cash", () => {
    const lines = [debit("pool_cash", 2000), credit("care_credit:ana", 2000)];
    expect(refusal(() => createEntry({ ...draft, lines }))).toBe("mixed_memo");
  });

  it("refuses an account the ledger does not know", () => {
    expect(refusal(() => describeAccount("savings"))).toBe("unknown_account");
    expect(refusal(() => describeAccount("member"))).toBe("unknown_account");
    expect(refusal(() => describeAccount("member:"))).toBe("unknown_account");
    expect(refusal(() => describeAccount("pool_cash:ana"))).toBe("unknown_account");
    expect(refusal(() => describeAccount("member:a:b"))).toBe("unknown_account");
    expect(refusal(() => describeAccount("constructor"))).toBe("unknown_account");
  });

  it("refuses an entry without an identity or a cause", () => {
    expect(refusal(() => createEntry({ ...draft, id: "" }))).toBe("invalid_entry");
    expect(
      refusal(() =>
        createEntry({ ...draft, source: { type: "approval", id: " " } }),
      ),
    ).toBe("invalid_entry");
  });

  it("cannot be changed once built", () => {
    const entry = createEntry(draft);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.lines)).toBe(true);
    expect(entry.lines.every((line) => Object.isFrozen(line))).toBe(true);
  });

  it("balances every entry the posting rules can build", () => {
    forAll(randomEntries, (entries) => {
      for (const entry of entries) {
        expect(sideTotal(entry, "debit")).toBe(sideTotal(entry, "credit"));
      }
    });
  });
});

describe("reverseEntry", () => {
  it("swaps the sides and points to the original", () => {
    const original = createEntry(draft);
    const reversal = reverseEntry(original, {
      id: "entry-refund-1",
      occurredOn: "2026-10-20",
      period: "2026-10",
      description: "Marcus's contribution was refunded",
      source: { type: "paypal_event", id: "refund-1" },
    });

    expect(reversal.reverses).toBe(original.id);
    expect(reversal.kind).toBe(original.kind);
    expect(reversal.lines).toEqual([
      credit("pool_cash", 19272),
      credit("fees", 728),
      debit("member:marcus", 20000),
    ]);
  });
});
