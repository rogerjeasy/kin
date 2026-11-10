import { describe, expect, it } from "vitest";

import { rosesMonth } from "./examples/roses-month.ts";
import type { LedgerEntry } from "./ledger-entry.ts";
import { purseFunded, pursePaid } from "./postings.ts";
import { forAll, testHeader, type Random } from "./testing/index.ts";
import { auditLedger } from "./verify-ledger.ts";

const { ledger } = rosesMonth;
const audit = (entries: readonly LedgerEntry[]) => auditLedger(ledger.circleId, ledger.currency, entries);

describe("auditing an exported ledger", () => {
  it("finds nothing wrong with a ledger the domain built, and recomputes its pool", () => {
    const result = audit(ledger.entries);
    expect(result.problems).toEqual([]);
    expect(result.poolCents).toBe(result.balances.get("pool_cash"));
    expect(result.poolCashCents).toBe(result.poolCents);
    expect(result.purseCents).toBe(0);
  });

  it("flags every entry that leaves the Purse below zero, and no other, whatever the order of its floats and payments", () => {
    forAll(
      (random: Random) => Array.from({ length: random.int(1, 12) }, () => ({ funded: random.pick([true, false]), cents: random.int(1, 9_000) })),
      (steps) => {
        const entries = steps.map((step, index) => {
          const header = { ...testHeader(`purse-${index}`), circleId: ledger.circleId, currency: ledger.currency, period: rosesMonth.period };
          return step.funded ? purseFunded(header, { cents: step.cents }) : pursePaid(header, { cents: step.cents, feeCents: 0 });
        });
        // Rose's month first, so the pool has the money each float takes from it.
        const result = audit([...ledger.entries, ...entries]);
        let purse = 0;
        const below: string[] = [];
        steps.forEach((step, index) => {
          purse += step.funded ? step.cents : -step.cents;
          if (purse < 0) below.push(`entry-purse-${index}`);
        });
        expect(result.problems.filter((problem) => problem.code === "purse_overdrawn").map((problem) => problem.entryId)).toEqual(below);
        expect(result.purseCents).toBe(purse);
        expect(result.poolCents).toBe(result.poolCashCents + result.purseCents);
      },
    );
  });

  it("reports an entry that does not balance, a repeated cause and an unknown account without throwing", () => {
    const [first, second] = ledger.entries;
    if (first === undefined || second === undefined) throw new Error("expected entries");
    const unbalanced = { ...first, lines: first.lines.map((line, index) => (index === 0 ? { ...line, cents: line.cents + 1 } : line)) } as LedgerEntry;
    expect(audit([unbalanced]).problems.map((problem) => problem.code)).toContain("invalid_entry");
    expect(audit([first, { ...second, source: first.source }]).problems.map((problem) => problem.code)).toContain("duplicate_source");
    const odd = { ...first, lines: first.lines.map((line) => ({ ...line, account: "nonsense" })) } as unknown as LedgerEntry;
    expect(audit([odd]).problems.map((problem) => problem.code)).toContain("invalid_entry");
  });

  it("reports a reversal of an entry that is not there", () => {
    const [first] = ledger.entries;
    if (first === undefined) throw new Error("expected an entry");
    expect(audit([{ ...first, reverses: "missing" }]).problems.map((problem) => problem.code)).toContain("bad_reversal");
  });
});
