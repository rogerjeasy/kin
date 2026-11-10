import { entryHeadline } from "./entry-headline.ts";
import { FEES, describeAccount } from "./ledger-accounts.ts";
import type { EntryKind, LedgerEntry } from "./ledger-entry.ts";
import type { Ledger } from "./ledger.ts";
import { sumCents } from "./money.ts";

/** The spending category that caregiver pay is booked under. */
export const CAREGIVER_CATEGORY = "care";

export type StatementAmount = { readonly subject: string; readonly cents: number };

export type PeriodFigures = {
  /** Cash each member paid into the pool, net of reversals. */
  readonly contributions: readonly StatementAmount[];
  /** Spending by category, largest first: bills, purchases and receipts. */
  readonly spending: readonly StatementAmount[];
  /** Pay PayPal confirmed to each caregiver. */
  readonly caregiverPay: readonly StatementAmount[];
  readonly contributedCents: number;
  readonly spentCents: number;
  readonly caregiverPayCents: number;
  readonly feesCents: number;
  /** What settlement moved: collected from members, paid back to members. */
  readonly settlementCollectedCents: number;
  readonly settlementPaidCents: number;
  readonly entryCount: number;
};

/** A reversal keeps its original's kind and cancels it, so it counts against the total. */
function signed(entry: LedgerEntry, cents: number): number {
  return entry.reverses === null ? cents : -cents;
}

function byKind(entries: readonly LedgerEntry[], kind: EntryKind): LedgerEntry[] {
  return entries.filter((entry) => entry.kind === kind);
}

function headlineAmount(entry: LedgerEntry): StatementAmount {
  const { subject, cents } = entryHeadline(entry);
  return { subject, cents: signed(entry, cents) };
}

function groupBySubject(pairs: readonly StatementAmount[]): StatementAmount[] {
  const totals = new Map<string, number>();
  for (const { subject, cents } of pairs) totals.set(subject, (totals.get(subject) ?? 0) + cents);
  return [...totals]
    .map(([subject, cents]) => ({ subject, cents }))
    .filter(({ cents }) => cents !== 0)
    .toSorted((a, b) => b.cents - a.cents || a.subject.localeCompare(b.subject));
}

/** The category of the bill a payout settled: the payee's latest approval at or before it. */
function payoutCategory(ledger: Ledger, payout: LedgerEntry): string | null {
  const payee = entryHeadline(payout).subject;
  const upTo = ledger.entries.slice(0, ledger.entries.indexOf(payout) + 1);
  const approval = upTo.findLast((entry) => entry.kind === "bill_approved" && entryHeadline(entry).subject === payee);
  return approval ? entryHeadline(approval).category : null;
}

function expenseOf(entry: LedgerEntry): StatementAmount[] {
  return entry.lines.flatMap((line) => {
    const details = describeAccount(line.account);
    if (details.family !== "expense" || details.subject === null) return [];
    return [{ subject: details.subject, cents: signed(entry, line.direction === "debit" ? line.cents : -line.cents) }];
  });
}

const SPENDING_KINDS: readonly EntryKind[] = ["bill_approved", "purchase_captured", "out_of_pocket", "purse_paid"];

/**
 * Every figure of a set of entries, read from the ledger and nothing else.
 * The statement, the year in review and any spoken summary read through this,
 * so a screen, a printout and a voice cannot disagree.
 */
function figuresOf(ledger: Ledger, entries: readonly LedgerEntry[]): PeriodFigures {
  const contributions = groupBySubject(byKind(entries, "contribution").map(headlineAmount));
  const spending = groupBySubject(entries.filter((entry) => SPENDING_KINDS.includes(entry.kind)).flatMap(expenseOf));
  const caregiverPay = groupBySubject(
    byKind(entries, "payout_confirmed")
      .filter((entry) => payoutCategory(ledger, entry) === CAREGIVER_CATEGORY)
      .map(headlineAmount),
  );
  const amountOf = (kind: EntryKind) => sumCents(byKind(entries, kind).map((entry) => headlineAmount(entry).cents));
  return {
    contributions,
    spending,
    caregiverPay,
    contributedCents: sumCents(contributions.map((each) => each.cents)),
    spentCents: sumCents(spending.map((each) => each.cents)),
    caregiverPayCents: sumCents(caregiverPay.map((each) => each.cents)),
    feesCents: sumCents(entries.flatMap((entry) => entry.lines.filter((line) => line.account === FEES).map((line) => signed(entry, line.cents)))),
    settlementCollectedCents: amountOf("settlement_collection"),
    settlementPaidCents: amountOf("settlement_payout"),
    entryCount: entries.length,
  };
}

export type StatementQuery = {
  readonly ledger: Ledger;
  /** The month, as YYYY-MM. */
  readonly period: string;
};

/** The monthly family statement's figures. The same for every member who reads it. */
export function monthlyStatement(query: StatementQuery): PeriodFigures & { readonly period: string; readonly currency: string } {
  const { ledger, period } = query;
  const entries = ledger.entries.filter((entry) => entry.period === period);
  return { period, currency: ledger.currency, ...figuresOf(ledger, entries) };
}

export type YearMonth = { readonly period: string } & Pick<PeriodFigures, "contributedCents" | "spentCents" | "caregiverPayCents" | "entryCount">;

export type YearInReview = PeriodFigures & {
  readonly year: string;
  readonly currency: string;
  /** Twelve months, January first, including the quiet ones. */
  readonly months: readonly YearMonth[];
  /** What each member paid from their own pocket, largest first. */
  readonly ownPocket: readonly StatementAmount[];
};

/** A calendar year of the ledger: totals by category and by person, and each month. */
export function yearInReview(query: { readonly ledger: Ledger; readonly year: string }): YearInReview {
  const { ledger, year } = query;
  const entries = ledger.entries.filter((entry) => entry.period.startsWith(`${year}-`));
  const months = Array.from({ length: 12 }, (_, index) => {
    const period = `${year}-${String(index + 1).padStart(2, "0")}`;
    const { contributedCents, spentCents, caregiverPayCents, entryCount } = figuresOf(ledger, entries.filter((entry) => entry.period === period));
    return { period, contributedCents, spentCents, caregiverPayCents, entryCount };
  });
  const ownPocket = groupBySubject(byKind(entries, "out_of_pocket").map(headlineAmount));
  return { year, currency: ledger.currency, months, ownPocket, ...figuresOf(ledger, entries) };
}
