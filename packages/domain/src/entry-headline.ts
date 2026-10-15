import { FEES, POOL_CASH, describeAccount } from "./ledger-accounts.ts";
import type { EntryKind, LedgerEntry } from "./ledger-entry.ts";
import { LedgerError } from "./ledger-error.ts";
import { sumCents } from "./money.ts";

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

export type EntryHeadline = {
  /** The member, payee or category the entry is about. */
  readonly subject: string;
  /** The spending category, when the entry records spending. */
  readonly category: string | null;
  /** The amount of the line that names the subject: what a person is told. */
  readonly cents: number;
  /** PayPal's fee on the movement, or zero. */
  readonly feeCents: number;
  /** Whether the entry brought cash into the pool, took it out, or neither. */
  readonly poolFlow: "in" | "out" | "none";
};

/**
 * What an entry is about and the one amount that describes it. Screens and
 * spoken news both read amounts through this, so they always agree.
 */
export function entryHeadline(entry: LedgerEntry): EntryHeadline {
  const family = SUBJECT_FAMILY[entry.kind];
  const subjectLine = entry.lines.find((line) => describeAccount(line.account).family === family);
  const subject = subjectLine ? describeAccount(subjectLine.account).subject : null;
  if (!subjectLine || subject === null) {
    throw new LedgerError("invalid_entry", `Ledger entry "${entry.id}" names no ${family} account`);
  }
  const categoryLine = entry.lines.find((line) => describeAccount(line.account).family === "expense");
  return {
    subject,
    category: categoryLine ? describeAccount(categoryLine.account).subject : null,
    cents: subjectLine.cents,
    feeCents: sumCents(entry.lines.filter((line) => line.account === FEES).map((line) => line.cents)),
    poolFlow: poolFlowOf(entry),
  };
}

function poolFlowOf(entry: LedgerEntry): EntryHeadline["poolFlow"] {
  const poolLine = entry.lines.find((line) => line.account === POOL_CASH);
  if (!poolLine) return "none";
  return poolLine.direction === "debit" ? "in" : "out";
}
