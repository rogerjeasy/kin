import { rosesMonth, type LedgerEntry } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { buildBundle, claimSettlement, parseBundle, type AuditBundle, type StoredHead } from "./bundle.ts";
import { chainHashes } from "./chain.ts";
import { entryFigures, verifyBundle, wordingMatchesEntry } from "./verify.ts";

const { ledger, agreement, period } = rosesMonth;

function exportOf(entries: readonly LedgerEntry[] = ledger.entries, heads: readonly StoredHead[] = []): AuditBundle {
  return buildBundle({
    heads,
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

/** Heads Kin kept at earlier visits: after the third entry, the seventh and the whole record. */
function keptHeads(): StoredHead[] {
  const hashes = chainHashes(ledger.circleId, ledger.entries);
  return [3, 7, ledger.entries.length].map((count, at) => ({ count, head: hashes[count - 1] ?? "", recordedAt: `2026-10-0${at + 1}T09:00:00.000Z` }));
}

describe("verifying against the heads Kin kept earlier", () => {
  const headCheck = (bundle: AuditBundle) => verifyBundle(bundle).checks.find((check) => check.id === "head");

  it("passes an untouched export, with no outside head, and counts what it stood against", () => {
    const bundle = viaFile(exportOf(ledger.entries, keptHeads()));
    const report = verifyBundle(bundle);
    expect(report.ok).toBe(true);
    expect(report.keptHeads).toEqual({ count: 3, oldest: "2026-10-01T09:00:00.000Z" });
  });

  it("fails when an old entry was changed, with its own hash chain recomputed to match", () => {
    const heads = keptHeads();
    // Both sides of the second entry rise by a cent, so it still balances and every hash is recomputed: only the kept heads can tell.
    const entries = ledger.entries.map((entry, index) => (index === 1 ? ({ ...entry, lines: entry.lines.map((line) => ({ ...line, cents: line.cents + 1 })) } as LedgerEntry) : entry));
    const bundle = buildBundle({ ...exportOf(entries, heads), settlements: [], wording: [] });
    expect(checkOf(bundle, "chain")?.ok).toBe(true);
    expect(headCheck(bundle)?.ok).toBe(false);
    expect(verifyBundle(buildBundle({ ...exportOf(entries), settlements: [], wording: [] })).checks.find((check) => check.id === "head")?.ok).toBe(true);
  });

  it("fails when an old entry was removed", () => {
    const heads = keptHeads();
    const bundle = buildBundle({ ...exportOf(ledger.entries, heads), entries: ledger.entries.slice(2), settlements: [], wording: [] });
    expect(checkOf(bundle, "chain")?.ok).toBe(true);
    expect(headCheck(bundle)?.ok).toBe(false);
  });

  it("fails when the record is shorter than a head Kin kept", () => {
    const heads = keptHeads();
    const bundle = buildBundle({ ...exportOf(ledger.entries, heads), entries: ledger.entries.slice(0, 5), settlements: [], wording: [] });
    expect(headCheck(bundle)?.ok).toBe(false);
  });

  it("still takes a head written down by hand, beside the kept ones", () => {
    const full = exportOf(ledger.entries, keptHeads());
    expect(verifyBundle(full, { expectedHead: full.head }).ok).toBe(true);
    const shorter = buildBundle({ ...full, entries: full.entries.slice(1), heads: [], settlements: [], wording: [] });
    expect(verifyBundle(shorter, { expectedHead: full.head }).checks.find((check) => check.id === "head")?.ok).toBe(false);
  });

  it("reads an export from before heads were kept as having none, and refuses malformed ones", () => {
    const old: Record<string, unknown> = { ...exportOf() };
    delete old["heads"];
    expect(parseBundle(JSON.stringify(old)).heads).toEqual([]);
    expect(() => parseBundle(JSON.stringify({ ...old, heads: [{ count: -1, head: "x", recordedAt: "2026-10-01" }] }))).toThrow();
    expect(() => parseBundle(JSON.stringify({ ...old, heads: [{ count: 1, head: "x", recordedAt: "not a date" }] }))).toThrow();
  });
});

describe("wordingMatchesEntry", () => {
  const entry = exportOf().entries[0];
  const hold = entry === undefined ? "" : entryFigures(entry)[0] ?? "";

  it("accepts the entry's own amount however it is grouped", () => {
    expect(entry !== undefined && wordingMatchesEntry(`Paid ${hold}.`, entry)).toBe(true);
  });

  it("does not let a date part stand in for an amount with cents", () => {
    expect(entry !== undefined && wordingMatchesEntry(`Paid ${entry.occurredOn.slice(-2)}.99.`, entry)).toBe(false);
  });

  it("does not read 10.00 as 1,000", () => {
    expect(entry !== undefined && wordingMatchesEntry("Paid 1,000.", entry)).toBe(false);
  });

  it("refuses a date that is not the entry's own", () => {
    expect(entry !== undefined && wordingMatchesEntry("Paid on 1999-01-01.", entry)).toBe(false);
  });
});
