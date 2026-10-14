import { describeAccount, type AccountCode } from "./ledger-accounts.ts";
import {
  assertValidEntry,
  opposite,
  type LedgerEntry,
  type LedgerLine,
} from "./ledger-entry.ts";
import { LedgerError } from "./ledger-error.ts";
import { sumCents } from "./money.ts";

/**
 * One circle's ledger: its entries in the order they were accepted. It only
 * grows. Appending returns a new ledger and leaves the old one untouched.
 */
export type Ledger = {
  readonly circleId: string;
  readonly currency: string;
  readonly entries: readonly LedgerEntry[];
};

export type AppendResult = {
  readonly ledger: Ledger;
  /** False when the entry was already in the ledger and nothing changed. */
  readonly applied: boolean;
};

export function openLedger(circleId: string, currency: string): Ledger {
  return Object.freeze({ circleId, currency, entries: Object.freeze([]) });
}

/**
 * Adds an entry to the ledger. An entry whose source is already recorded
 * changes nothing, so applying the same event twice is safe. A different
 * entry claiming a recorded source is refused.
 */
export function appendEntry(ledger: Ledger, entry: LedgerEntry): AppendResult {
  assertValidEntry(entry);
  assertBelongs(ledger, entry);

  const recorded = ledger.entries.find((existing) =>
    sameSource(existing, entry),
  );
  if (recorded) {
    if (!sameEntry(recorded, entry)) {
      throw new LedgerError(
        "source_conflict",
        `Source ${entry.source.type}:${entry.source.id} is already recorded as a different entry`,
      );
    }
    return { ledger, applied: false };
  }
  if (ledger.entries.some((existing) => existing.id === entry.id)) {
    throw new LedgerError(
      "duplicate_id",
      `Ledger entry "${entry.id}" already exists`,
    );
  }
  if (entry.reverses !== null) {
    assertReverses(ledger, entry, entry.reverses);
  }
  return {
    ledger: Object.freeze({
      ...ledger,
      entries: Object.freeze([...ledger.entries, entry]),
    }),
    applied: true,
  };
}

/** Adds entries in order. Entries already recorded are skipped. */
export function appendEntries(
  ledger: Ledger,
  entries: readonly LedgerEntry[],
): Ledger {
  return entries.reduce(
    (current, entry) => appendEntry(current, entry).ledger,
    ledger,
  );
}

/**
 * An account's balance, counted on the side where that account grows. Cash in
 * the pool, money owed to a payee and a member's contributions all read as
 * positive numbers.
 */
export function accountBalance(ledger: Ledger, account: AccountCode): number {
  const { normal } = describeAccount(account);
  return sumCents(
    ledger.entries
      .flatMap((entry) => entry.lines)
      .filter((line) => line.account === account)
      .map((line) => (line.direction === normal ? line.cents : -line.cents)),
  );
}

/** Every account the ledger has touched, with its balance. */
export function accountBalances(
  ledger: Ledger,
): ReadonlyMap<AccountCode, number> {
  const accounts = new Set(
    ledger.entries.flatMap((entry) => entry.lines.map((line) => line.account)),
  );
  return new Map(
    [...accounts].map((account) => [account, accountBalance(ledger, account)]),
  );
}

function assertBelongs(ledger: Ledger, entry: LedgerEntry): void {
  if (entry.circleId !== ledger.circleId) {
    throw new LedgerError(
      "wrong_circle",
      `Ledger entry "${entry.id}" belongs to another circle`,
    );
  }
  if (entry.currency !== ledger.currency) {
    throw new LedgerError(
      "wrong_currency",
      `Ledger entry "${entry.id}" is in ${entry.currency}, the ledger is in ${ledger.currency}`,
    );
  }
}

function assertReverses(
  ledger: Ledger,
  entry: LedgerEntry,
  originalId: string,
): void {
  const refusal = reversalRefusal(ledger, entry, originalId);
  if (refusal !== null) {
    throw new LedgerError(
      "invalid_reversal",
      `Ledger entry "${entry.id}" is refused: ${refusal}`,
    );
  }
}

function reversalRefusal(
  ledger: Ledger,
  entry: LedgerEntry,
  originalId: string,
): string | null {
  const original = ledger.entries.find(
    (existing) => existing.id === originalId,
  );
  if (!original) {
    return "the entry it reverses is not in the ledger";
  }
  if (original.reverses !== null) {
    return "a reversal cannot itself be reversed";
  }
  if (ledger.entries.some((existing) => existing.reverses === originalId)) {
    return "the entry is already reversed";
  }
  if (entry.kind !== original.kind || !mirrors(entry, original)) {
    return "it is not the mirror of the entry it reverses";
  }
  return null;
}

function mirrors(reversal: LedgerEntry, original: LedgerEntry): boolean {
  return sameLines(
    reversal.lines,
    original.lines.map((line) => ({
      ...line,
      direction: opposite(line.direction),
    })),
  );
}

function sameSource(a: LedgerEntry, b: LedgerEntry): boolean {
  return a.source.type === b.source.type && a.source.id === b.source.id;
}

function sameEntry(a: LedgerEntry, b: LedgerEntry): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.occurredOn === b.occurredOn &&
    a.period === b.period &&
    a.description === b.description &&
    a.simulated === b.simulated &&
    a.reverses === b.reverses &&
    sameLines(a.lines, b.lines)
  );
}

function sameLines(
  a: readonly LedgerLine[],
  b: readonly LedgerLine[],
): boolean {
  return (
    a.length === b.length &&
    a.every((line, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        line.account === other.account &&
        line.direction === other.direction &&
        line.cents === other.cents
      );
    })
  );
}
