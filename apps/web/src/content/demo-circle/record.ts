import {
  FEES,
  POOL_CASH,
  accountBalance,
  accountBalances,
  describeAccount,
  rosesMonth,
  sumCents,
  type EntryKind,
  type LedgerEntry,
} from "@kin/domain";

/** The account whose line names what an entry of each kind is about. */
const SUBJECT_FAMILY = {
  contribution: "member",
  out_of_pocket: "member",
  bill_approved: "payable",
  payout_confirmed: "payable",
  purchase_captured: "expense",
  care_credit: "care_credit",
  settlement_collection: "member",
  settlement_payout: "member",
} as const satisfies Record<EntryKind, string>;

export type EntryView = {
  readonly entry: LedgerEntry;
  /** The member, payee or category the entry is about. */
  readonly subject: string;
  /** The spending category, when the entry records spending. */
  readonly category: string | null;
  /** The amount of the line that names the subject. */
  readonly cents: number;
  /** PayPal's fee on the movement, or zero. */
  readonly feeCents: number;
  /** Whether the entry brought cash into the pool, took it out, or neither. */
  readonly poolFlow: "in" | "out" | "none";
};

/** One ledger entry, read for a person: who or what it is about, and how much. */
export function entryView(entry: LedgerEntry): EntryView {
  const family = SUBJECT_FAMILY[entry.kind];
  const subjectLine = entry.lines.find((line) => describeAccount(line.account).family === family);
  const subject = subjectLine ? describeAccount(subjectLine.account).subject : null;
  if (!subjectLine || subject === null) {
    throw new Error(`Ledger entry ${entry.id} names no ${family} account`);
  }
  const categoryLine = entry.lines.find((line) => describeAccount(line.account).family === "expense");
  return {
    entry,
    subject,
    category: categoryLine ? describeAccount(categoryLine.account).subject : null,
    cents: subjectLine.cents,
    feeCents: sumCents(entry.lines.filter((line) => line.account === FEES).map((line) => line.cents)),
    poolFlow: poolFlowOf(entry),
  };
}

function poolFlowOf(entry: LedgerEntry): EntryView["poolFlow"] {
  const poolLine = entry.lines.find((line) => line.account === POOL_CASH);
  if (!poolLine) return "none";
  return poolLine.direction === "debit" ? "in" : "out";
}

/**
 * Rose's month, newest day first. Entries of the same day keep the reverse of
 * the order the ledger accepted them, so the latest stays on top.
 */
export function recordEntries(): EntryView[] {
  return rosesMonth.ledger.entries
    .map(entryView)
    .toReversed()
    .toSorted((a, b) => b.entry.occurredOn.localeCompare(a.entry.occurredOn));
}

function totalOf(kinds: readonly EntryKind[]): number {
  return sumCents(rosesMonth.ledger.entries.filter((entry) => kinds.includes(entry.kind)).map((entry) => entryView(entry).cents));
}

/** The month's headline figures, read from the ledger. */
export function monthTotals() {
  return {
    poolCents: accountBalance(rosesMonth.ledger, POOL_CASH),
    paidInCents: totalOf(["contribution"]),
    paidOutCents: totalOf(["payout_confirmed", "purchase_captured"]),
    feesCents: accountBalance(rosesMonth.ledger, FEES),
    entryCount: rosesMonth.ledger.entries.length,
  };
}

/** What October's spending went on, by category, largest first. */
export function spendingByCategory(): { category: string; cents: number }[] {
  return [...accountBalances(rosesMonth.ledger)]
    .map(([account, cents]) => ({ details: describeAccount(account), cents }))
    .filter(({ details, cents }) => details.family === "expense" && details.subject !== null && cents > 0)
    .map(({ details, cents }) => ({ category: details.subject ?? "", cents }))
    .toSorted((a, b) => b.cents - a.cents);
}

/** The headline amount of the entry recorded from a given source. */
export function amountFromSource(sourceId: string): number {
  const entry = rosesMonth.ledger.entries.find((each) => each.source.id === sourceId);
  if (!entry) {
    throw new Error(`Rose's month records nothing from ${sourceId}`);
  }
  return entryView(entry).cents;
}

/** The day an entry from a given source happened, as YYYY-MM-DD. */
export function dayOfSource(sourceId: string): string {
  const entry = rosesMonth.ledger.entries.find((each) => each.source.id === sourceId);
  if (!entry) {
    throw new Error(`Rose's month records nothing from ${sourceId}`);
  }
  return entry.occurredOn;
}

export type PaidBill = {
  readonly id: string;
  readonly payeeId: string;
  readonly category: string | null;
  readonly approvedOn: string | null;
  readonly paidOn: string;
  readonly cents: number;
  readonly feeCents: number;
};

/** Every bill PayPal confirmed paid this month, with the day it was approved. */
export function paidBills(): PaidBill[] {
  const entries = recordEntries();
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
      };
    });
}
