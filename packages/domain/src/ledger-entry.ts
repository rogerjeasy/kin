import {
  describeAccount,
  type AccountCode,
  type Direction,
} from "./ledger-accounts.ts";
import { LedgerError } from "./ledger-error.ts";
import { assertCents, sumCents } from "./money.ts";

/** The financial facts a circle's ledger records. */
export const ENTRY_KINDS = [
  "contribution",
  "out_of_pocket",
  "bill_approved",
  "payout_confirmed",
  "purchase_captured",
  "settlement_collection",
  "settlement_payout",
  "care_credit",
  "purse_funded",
  "purse_paid",
] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number];

/** What can cause a ledger entry. */
export const ENTRY_SOURCE_TYPES = ["paypal_event", "approval", "settlement"] as const;

/** Every entry names its cause: a PayPal event, an approval or a settlement. */
export type EntrySource = {
  readonly type: (typeof ENTRY_SOURCE_TYPES)[number];
  /** Unique within its type for a circle. The ledger's idempotency key. */
  readonly id: string;
};

export type LedgerLine = {
  readonly account: AccountCode;
  readonly direction: Direction;
  /** Always above zero. The direction carries the sign. */
  readonly cents: number;
};

/** A balanced, permanent record of one financial fact. */
export type LedgerEntry = {
  readonly id: string;
  readonly circleId: string;
  readonly kind: EntryKind;
  /** Calendar date in the circle's timezone, as YYYY-MM-DD. */
  readonly occurredOn: string;
  /** The settlement period the entry counts toward, as YYYY-MM. */
  readonly period: string;
  readonly description: string;
  readonly source: EntrySource;
  readonly currency: string;
  /** True when no real PayPal sandbox transaction stands behind the entry. */
  readonly simulated: boolean;
  /** The ID of the entry this one cancels, or `null`. */
  readonly reverses: string | null;
  readonly lines: readonly LedgerLine[];
};

export type EntryDraft = Omit<LedgerEntry, "reverses">;

/** The facts every entry carries, whatever it records. */
export type EntryHeader = Omit<EntryDraft, "kind" | "lines">;

export const debit = (account: AccountCode, cents: number): LedgerLine => ({
  account,
  direction: "debit",
  cents,
});

export const credit = (account: AccountCode, cents: number): LedgerLine => ({
  account,
  direction: "credit",
  cents,
});

/** Builds an entry, and refuses one that breaks a ledger rule. */
export function createEntry(draft: EntryDraft): LedgerEntry {
  return seal({ ...draft, reverses: null });
}

/**
 * Rebuilds an entry read back from storage, reversal link included, and
 * refuses one that breaks a ledger rule. Storage is not trusted to be right.
 */
export function restoreEntry(stored: LedgerEntry): LedgerEntry {
  return seal(stored);
}

export type Correction = Pick<
  EntryHeader,
  "id" | "occurredOn" | "period" | "description" | "source"
>;

/**
 * Builds the entry that cancels `original`: the same lines with the sides
 * swapped. It keeps the original's kind, so a period's totals net to what
 * really happened.
 */
export function reverseEntry(
  original: LedgerEntry,
  correction: Correction,
): LedgerEntry {
  return seal({
    ...correction,
    circleId: original.circleId,
    kind: original.kind,
    currency: original.currency,
    simulated: original.simulated,
    reverses: original.id,
    lines: original.lines.map((line) => ({
      ...line,
      direction: opposite(line.direction),
    })),
  });
}

export function opposite(direction: Direction): Direction {
  return direction === "debit" ? "credit" : "debit";
}

/** Checks the rules every entry must meet before the ledger accepts it. */
export function assertValidEntry(entry: LedgerEntry): void {
  const texts = {
    id: entry.id,
    circleId: entry.circleId,
    occurredOn: entry.occurredOn,
    period: entry.period,
    description: entry.description,
    "source.id": entry.source.id,
    currency: entry.currency,
  };
  for (const [field, value] of Object.entries(texts)) {
    if (value.trim() === "") {
      throw new LedgerError(
        "invalid_entry",
        `Ledger entry "${entry.id}" has an empty ${field}`,
      );
    }
  }
  if (entry.lines.length < 2) {
    throw new LedgerError(
      "invalid_entry",
      `Ledger entry "${entry.id}" needs at least two lines`,
    );
  }
  for (const line of entry.lines) {
    assertCents(line.cents);
    if (line.cents <= 0) {
      throw new LedgerError(
        "invalid_entry",
        `Ledger entry "${entry.id}" has a line that is not above zero`,
      );
    }
  }
  assertUnmixed(entry);
  assertBalanced(entry);
}

function assertUnmixed(entry: LedgerEntry): void {
  const memoLines = entry.lines.filter(
    (line) => describeAccount(line.account).type === "memo",
  ).length;
  if (memoLines !== 0 && memoLines !== entry.lines.length) {
    throw new LedgerError(
      "mixed_memo",
      `Ledger entry "${entry.id}" mixes care credit with cash accounts`,
    );
  }
}

function assertBalanced(entry: LedgerEntry): void {
  const debits = sideTotal(entry, "debit");
  const credits = sideTotal(entry, "credit");
  if (debits !== credits) {
    throw new LedgerError(
      "unbalanced",
      `Ledger entry "${entry.id}" does not balance: debits ${debits}, credits ${credits}`,
    );
  }
}

function sideTotal(entry: LedgerEntry, direction: Direction): number {
  return sumCents(
    entry.lines
      .filter((line) => line.direction === direction)
      .map((line) => line.cents),
  );
}

function seal(entry: LedgerEntry): LedgerEntry {
  const sealed: LedgerEntry = {
    ...entry,
    source: Object.freeze({ ...entry.source }),
    lines: Object.freeze(entry.lines.map((line) => Object.freeze({ ...line }))),
  };
  assertValidEntry(sealed);
  return Object.freeze(sealed);
}
