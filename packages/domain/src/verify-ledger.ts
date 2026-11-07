import { POOL_CASH, describeAccount } from "./ledger-accounts.ts";
import { assertValidEntry, opposite, type LedgerEntry, type LedgerLine } from "./ledger-entry.ts";
import { accountBalances } from "./ledger.ts";
import { LedgerError } from "./ledger-error.ts";

export const LEDGER_PROBLEMS = [
  "invalid_entry",
  "duplicate_id",
  "duplicate_source",
  "wrong_circle",
  "wrong_currency",
  "bad_reversal",
  "pool_overdrawn",
] as const;

export type LedgerProblemCode = (typeof LEDGER_PROBLEMS)[number];

/** One rule an exported ledger breaks, with the entry that breaks it. */
export type LedgerProblem = {
  readonly code: LedgerProblemCode;
  readonly entryId: string;
  readonly detail: string;
};

export type LedgerAudit = {
  readonly problems: readonly LedgerProblem[];
  /** Every account's balance, recomputed from the lines alone, in cents. */
  readonly balances: ReadonlyMap<string, number>;
  readonly poolCents: number;
};

const mirrors = (reversal: readonly LedgerLine[], original: readonly LedgerLine[]): boolean =>
  reversal.length === original.length &&
  reversal.every((line, index) => {
    const other = original[index];
    return other !== undefined && line.account === other.account && line.cents === other.cents && line.direction === opposite(other.direction);
  });

function reversalProblem(entry: LedgerEntry, earlier: ReadonlyMap<string, LedgerEntry>, reversed: ReadonlySet<string>): string | null {
  if (entry.reverses === null) return null;
  const original = earlier.get(entry.reverses);
  if (original === undefined) return "it reverses an entry that does not come before it";
  if (original.reverses !== null) return "it reverses a reversal";
  if (reversed.has(original.id)) return "the entry it reverses was already reversed";
  if (original.kind !== entry.kind || !mirrors(entry.lines, original.lines)) return "it is not the mirror of the entry it reverses";
  return null;
}

/**
 * Re-checks every rule the ledger enforces on the way in, against entries read
 * from an export, and recomputes the balances from the lines. It never throws
 * and never trusts the export: a broken rule is reported, not repaired.
 */
export function auditLedger(circleId: string, currency: string, entries: readonly LedgerEntry[]): LedgerAudit {
  const problems: LedgerProblem[] = [];
  const problem = (code: LedgerProblemCode, entry: LedgerEntry, detail: string) => problems.push({ code, entryId: entry.id, detail });
  const earlier = new Map<string, LedgerEntry>();
  const sources = new Set<string>();
  const reversed = new Set<string>();
  let pool = 0;
  const poolNormal = describeAccount(POOL_CASH).normal;

  for (const entry of entries) {
    try {
      assertValidEntry(entry);
    } catch (error) {
      problem("invalid_entry", entry, error instanceof LedgerError ? error.message : "it cannot be read as a ledger entry");
    }
    if (earlier.has(entry.id)) problem("duplicate_id", entry, "its ID was already used");
    const source = `${entry.source.type}:${entry.source.id}`;
    if (sources.has(source)) problem("duplicate_source", entry, "its cause was already recorded");
    if (entry.circleId !== circleId) problem("wrong_circle", entry, "it belongs to another circle");
    if (entry.currency !== currency) problem("wrong_currency", entry, "it is in another currency");
    const refusal = reversalProblem(entry, earlier, reversed);
    if (refusal !== null) problem("bad_reversal", entry, refusal);
    for (const line of entry.lines) {
      if (line.account === POOL_CASH) pool += line.direction === poolNormal ? line.cents : -line.cents;
    }
    if (pool < 0) problem("pool_overdrawn", entry, "more money left the pool than had arrived");
    earlier.set(entry.id, entry);
    sources.add(source);
    if (entry.reverses !== null) reversed.add(entry.reverses);
  }

  return { problems, balances: safeBalances({ circleId, currency, entries }), poolCents: pool };
}

/** Balances of the entries, or none when an account in them is not one the ledger knows (reported as an invalid entry). */
function safeBalances(ledger: Parameters<typeof accountBalances>[0]): ReadonlyMap<string, number> {
  try {
    return accountBalances(ledger);
  } catch (error) {
    if (error instanceof LedgerError) return new Map();
    throw error;
  }
}
