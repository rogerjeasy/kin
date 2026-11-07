import { describe, expect, it } from "vitest";

import { rosesMonth } from "./examples/roses-month.ts";
import type { LedgerEntry } from "./ledger-entry.ts";
import { auditLedger } from "./verify-ledger.ts";

const { ledger } = rosesMonth;
const audit = (entries: readonly LedgerEntry[]) => auditLedger(ledger.circleId, ledger.currency, entries);

describe("auditing an exported ledger", () => {
  it("finds nothing wrong with a ledger the domain built, and recomputes its pool", () => {
    const result = audit(ledger.entries);
    expect(result.problems).toEqual([]);
    expect(result.poolCents).toBe(result.balances.get("pool_cash"));
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
