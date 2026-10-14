import type { Agreement } from "./agreement.ts";
import type { FairnessInput } from "./fairness.ts";
import { describeAccount } from "./ledger-accounts.ts";
import type { EntryKind, LedgerEntry } from "./ledger-entry.ts";
import type { Ledger } from "./ledger.ts";
import { sumCents } from "./money.ts";

/** What a member gave in a period, by the kind of entry that records it. */
const GIVING_KINDS = {
  contribution: { family: "member", field: "paidInCents" },
  out_of_pocket: { family: "member", field: "outOfPocketCents" },
  care_credit: { family: "care_credit", field: "careCreditCents" },
} as const satisfies Partial<Record<EntryKind, unknown>>;

type GivingField = (typeof GIVING_KINDS)[keyof typeof GIVING_KINDS]["field"];
type Given = Record<GivingField, number>;

/** The ledger holds something the agreement cannot place. Retrying cannot help. */
export class PeriodInputError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "PeriodInputError";
  }
}

export type PeriodQuery = {
  readonly ledger: Ledger;
  readonly agreement: Agreement;
  /** The period to measure, as YYYY-MM. */
  readonly period: string;
  /** What the last settlement left open for each member. Absent means zero. */
  readonly carriedIn?: ReadonlyMap<string, number>;
};

/**
 * Reads a period's fairness inputs from the ledger. Settlement movements are
 * left out: they close an earlier period and are not new contributions. A
 * reversed entry nets to nothing, because a reversal keeps its original's kind.
 */
export function periodInputs(query: PeriodQuery): FairnessInput {
  const { ledger, agreement, period, carriedIn = new Map() } = query;
  const given = new Map<string, Given>(
    agreement.shares.map((share) => [share.memberId, noGiving()]),
  );
  for (const entry of ledger.entries) {
    if (entry.period === period && isGivingKind(entry.kind)) {
      addGiving(given, entry, GIVING_KINDS[entry.kind]);
    }
  }
  for (const memberId of carriedIn.keys()) {
    givingOf(given, memberId, "a balance carried in");
  }

  return {
    currency: ledger.currency,
    careCreditPaidInCash: agreement.care?.paidInCash ?? false,
    members: agreement.shares.map((share) => {
      const totals = givingOf(given, share.memberId, "a share");
      return {
        memberId: share.memberId,
        shareBps: share.bps,
        paidInCents: totals.paidInCents,
        outOfPocketCents: totals.outOfPocketCents,
        // Care hours count only while the agreement says they do.
        careCreditCents: agreement.care ? totals.careCreditCents : 0,
        carriedInCents: carriedIn.get(share.memberId) ?? 0,
      };
    }),
  };
}

function addGiving(
  given: Map<string, Given>,
  entry: LedgerEntry,
  rule: (typeof GIVING_KINDS)[keyof typeof GIVING_KINDS],
): void {
  for (const line of entry.lines) {
    const account = describeAccount(line.account);
    if (account.family !== rule.family || account.subject === null) {
      continue;
    }
    const totals = givingOf(given, account.subject, `entry "${entry.id}"`);
    const signed = line.direction === account.normal ? line.cents : -line.cents;
    totals[rule.field] = sumCents([totals[rule.field], signed]);
  }
}

// A member without a share has no target, so what they gave would silently
// drop out of the calculation. Stop instead.
function givingOf(
  given: Map<string, Given>,
  memberId: string,
  origin: string,
): Given {
  const totals = given.get(memberId);
  if (!totals) {
    throw new PeriodInputError(
      `Member "${memberId}" has ${origin} but no share in the agreement`,
    );
  }
  return totals;
}

function noGiving(): Given {
  return { paidInCents: 0, outOfPocketCents: 0, careCreditCents: 0 };
}

function isGivingKind(kind: EntryKind): kind is keyof typeof GIVING_KINDS {
  return Object.hasOwn(GIVING_KINDS, kind);
}
