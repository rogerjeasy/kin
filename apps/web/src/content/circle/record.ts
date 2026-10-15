import { FEES, POOL_CASH, accountBalance, accountBalances, describeAccount, entryHeadline, sumCents, type EntryHeadline, type EntryKind, type LedgerEntry } from "@kin/domain";
import type { CircleSnapshot } from "@kin/db";

export type EntryView = EntryHeadline & { readonly entry: LedgerEntry };

/** One ledger entry, read for a person: who or what it is about, and how much. */
export function entryView(entry: LedgerEntry): EntryView {
  return { entry, ...entryHeadline(entry) };
}

/**
 * The circle's record, newest day first. Entries of the same day keep the
 * reverse of the order the ledger accepted them, so the latest stays on top.
 */
export function recordEntries(circle: CircleSnapshot): EntryView[] {
  return circle.ledger.entries
    .map(entryView)
    .toReversed()
    .toSorted((a, b) => b.entry.occurredOn.localeCompare(a.entry.occurredOn));
}

function periodEntries(circle: CircleSnapshot, period: string): LedgerEntry[] {
  return circle.ledger.entries.filter((entry) => entry.period === period);
}

function totalOf(entries: readonly LedgerEntry[], kinds: readonly EntryKind[]): number {
  return sumCents(entries.filter((entry) => kinds.includes(entry.kind)).map((entry) => entryHeadline(entry).cents));
}

/** The headline figures: the pool as it stands, and the period's money in and out. */
export function monthTotals(circle: CircleSnapshot, period: string) {
  const entries = periodEntries(circle, period);
  return {
    poolCents: accountBalance(circle.ledger, POOL_CASH),
    paidInCents: totalOf(entries, ["contribution"]),
    paidOutCents: totalOf(entries, ["payout_confirmed", "purchase_captured"]),
    feesCents: sumCents(entries.flatMap((entry) => entry.lines.filter((line) => line.account === FEES).map((line) => line.cents))),
    entryCount: entries.length,
  };
}

/** What the period's spending went on, by category, largest first. */
export function spendingByCategory(circle: CircleSnapshot, period: string): { category: string; cents: number }[] {
  const ledger = { ...circle.ledger, entries: periodEntries(circle, period) };
  return [...accountBalances(ledger)]
    .map(([account, cents]) => ({ details: describeAccount(account), cents }))
    .filter(({ details, cents }) => details.family === "expense" && details.subject !== null && cents > 0)
    .map(({ details, cents }) => ({ category: details.subject ?? "", cents }))
    .toSorted((a, b) => b.cents - a.cents);
}

export type PaidBill = {
  readonly id: string;
  readonly payeeId: string;
  readonly category: string | null;
  readonly approvedOn: string | null;
  readonly paidOn: string;
  readonly cents: number;
  readonly feeCents: number;
  readonly simulated: boolean;
};

/** Every bill PayPal confirmed paid, newest first, with the day it was approved. */
export function paidBills(circle: CircleSnapshot): PaidBill[] {
  const entries = recordEntries(circle);
  return entries
    .filter((view) => view.entry.kind === "payout_confirmed")
    .map((paid) => {
      const approval = entries.find((view) => view.entry.kind === "bill_approved" && view.subject === paid.subject);
      return {
        id: paid.entry.id,
        payeeId: paid.subject,
        category: approval?.category ?? null,
        approvedOn: approval?.entry.occurredOn ?? null,
        paidOn: paid.entry.occurredOn,
        cents: paid.cents,
        feeCents: paid.feeCents,
        simulated: paid.entry.simulated,
      };
    });
}

/** The entry with this ID, if the person can see it. */
export function entryById(circle: CircleSnapshot, entryId: string | null): LedgerEntry | null {
  if (entryId === null) return null;
  return circle.ledger.entries.find((entry) => entry.id === entryId) ?? null;
}
