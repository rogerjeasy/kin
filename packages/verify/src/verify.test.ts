import { rosesMonth, type LedgerEntry } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { buildBundle, claimSettlement, parseBundle, type AuditBundle } from "./bundle.ts";
import { entryFigures, verifyBundle } from "./verify.ts";

const { ledger, agreement, period } = rosesMonth;

function exportOf(entries: readonly LedgerEntry[] = ledger.entries): AuditBundle {
  return buildBundle({
    circleId: ledger.circleId,
    currency: ledger.currency,
    generatedOn: "2026-10-31",
    entries,
    wording: entries.map((entry) => ({ entryId: entry.id, text: `${entry.description} ${entryFigures(entry)[0]}` })),
    settlements: [claimSettlement(entries, ledger.circleId, ledger.currency, agreement, period, rosesMonth.payoutFee())],
  });
}

/** Writes the export out and reads it back, as the command does. */
const viaFile = (bundle: AuditBundle) => parseBundle(JSON.stringify(bundle));
const checkOf = (bundle: AuditBundle, id: string) => verifyBundle(bundle).checks.find((check) => check.id === id);

describe("verifying an export of Rose's month", () => {
  it("passes every check on an untouched export", () => {
    const report = verifyBundle(viaFile(exportOf()));
    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("fails the chain when one amount is changed, and names the entry", () => {
    const bundle = exportOf();
    const [first, ...rest] = bundle.entries;
    const changed = { ...first, lines: first?.lines.map((line, index) => (index === 0 ? { ...line, cents: line.cents + 1 } : line)) } as LedgerEntry;
    const report = verifyBundle({ ...bundle, entries: [changed, ...rest] });
    expect(report.ok).toBe(false);
    expect(checkOf({ ...bundle, entries: [changed, ...rest] }, "chain")?.entryIds).toEqual([first?.id]);
  });

  it("fails the ledger check on an entry that does not balance, even when its hash was recomputed to match", () => {
    const entries = ledger.entries.map((entry, index) => (index === 3 ? ({ ...entry, lines: entry.lines.map((line, at) => (at === 0 ? { ...line, cents: line.cents + 1 } : line)) } as LedgerEntry) : entry));
    const bundle = buildBundle({ ...exportOf(), entries, settlements: [], wording: [] });
    expect(checkOf(bundle, "chain")?.ok).toBe(true);
    expect(checkOf(bundle, "ledger")?.ok).toBe(false);
  });

  it("fails when an entry is removed, and when a head written down earlier is gone", () => {
    const full = exportOf();
    const shorter = buildBundle({ ...full, entries: full.entries.slice(1), settlements: [], wording: [] });
    expect(verifyBundle(shorter, { expectedHead: full.head }).checks.find((check) => check.id === "head")?.ok).toBe(false);
    expect(verifyBundle(full, { expectedHead: full.head }).ok).toBe(true);
  });

  it("fails a settlement whose plan was altered", () => {
    const bundle = exportOf();
    const [claim] = bundle.settlements;
    const [payout] = claim?.plan.payouts ?? [];
    if (claim === undefined || payout === undefined) throw new Error("Rose's month should settle with a payout");
    const forged = { ...claim, plan: { ...claim.plan, payouts: [{ ...payout, cents: payout.cents + 100 }, ...claim.plan.payouts.slice(1)] } };
    expect(checkOf({ ...bundle, settlements: [forged] }, "settlement")?.ok).toBe(false);
  });

  it("fails wording that states a figure the entry does not hold", () => {
    const bundle = exportOf();
    const [first] = bundle.entries;
    expect(checkOf({ ...bundle, wording: [{ entryId: first?.id ?? "", text: "A payment of 999.99 was made." }] }, "wording")?.ok).toBe(false);
  });

  it("refuses a file that is not an export", () => {
    expect(() => parseBundle("{}")).toThrow();
    expect(() => parseBundle("not json")).toThrow();
  });
});
