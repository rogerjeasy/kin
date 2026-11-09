import { workCoverage, type CareAgreementFacts, type NotCoveredReason } from "./care-agreement.ts";
import { entryHeadline } from "./entry-headline.ts";
import type { LedgerEntry } from "./ledger-entry.ts";
import { sumCents } from "./money.ts";
import { judgeRate, type RateJudgement } from "./rate-benchmark.ts";

/**
 * The look-back view: every payment that left the pool in the 60 months before
 * `today`, sorted into what it was, and which of them lack the paper a
 * reviewer asks for. Medicaid looks back 60 months at transfers and can treat
 * money paid to a person as a gift unless it is documented. This is a plain
 * classification of the record for the family's attorney. It says what is
 * documented and what is not; it never says a family is safe.
 */
export const LOOKBACK_MONTHS = 60;

/** What a payment out of the pool was. */
export const OUTFLOW_CLASSES = ["caregiver_pay", "third_party_bill", "purchase_for_parent", "family_transfer"] as const;
export type OutflowClass = (typeof OUTFLOW_CLASSES)[number];

/** Why a payment lacks documentation. */
export const LACKING_REASONS = ["no_agreement", "agreement_unsigned", "before_agreement", "after_agreement", "rate_not_agreed", "no_document", "family_transfer"] as const;
export type LackingReason = (typeof LACKING_REASONS)[number];

/** Notes that do not make a payment undocumented, but that a reader should see. */
/** `simulated` and `paypal` are exclusive: each payment either stands for no money or went through PayPal, and a reader must always be told which. */
export const OUTFLOW_MARKS = ["unverified_hours", "simulated", "paypal", "rate_below_market", "rate_above_market"] as const;
export type OutflowMark = (typeof OUTFLOW_MARKS)[number];

export type OutflowStatus = "documented" | "needs_documentation" | "reversed";

/** What the record knows about the work behind one payment out of the pool. */
export type WorkFacts = {
  /** The days of work the payment was for. */
  readonly dates: readonly string[];
  /** Whether every hour has both keys of the visit proof: the caregiver's own check-in and out, and the family's word. */
  readonly verified: boolean;
  readonly rateCentsPerHour: number | null;
};

export type LookbackContext = {
  /** The circle's calendar day now. */
  readonly today: string;
  readonly currency: string;
  /** The payees who are caregivers. */
  readonly caregiverPayeeIds: ReadonlySet<string>;
  readonly agreements: readonly CareAgreementFacts[];
  /** The work behind each caregiver payment, by the ledger entry that records it. */
  readonly work: ReadonlyMap<string, WorkFacts>;
  /** The entries that have a stored invoice, receipt or merchant order behind them. */
  readonly documented: ReadonlySet<string>;
};

export type OutflowRow = {
  readonly entryId: string;
  readonly class: OutflowClass;
  readonly status: OutflowStatus;
  readonly reasons: readonly LackingReason[];
  readonly marks: readonly OutflowMark[];
  readonly occurredOn: string;
  /** What was paid, without PayPal's fee. */
  readonly cents: number;
  readonly subject: string;
  readonly simulated: boolean;
  /** The agreement that covers a caregiver payment, when one does. */
  readonly agreementId: string | null;
  /** The entry that cancelled this one, when it was reversed. */
  readonly reversedBy: string | null;
};

export type LookbackSummary = {
  readonly from: string;
  readonly to: string;
  readonly rows: readonly OutflowRow[];
  /** Everything that left the pool in the window and was not reversed. */
  readonly outflowCents: number;
  readonly documentedCents: number;
  readonly lackingCents: number;
  readonly byClass: Readonly<Record<OutflowClass, { readonly count: number; readonly cents: number; readonly lackingCents: number }>>;
};

/** The first day of the window: the same calendar day five years back. 29 February becomes 28 February. */
export function lookbackStart(today: string): string {
  const year = Number(today.slice(0, 4)) - LOOKBACK_MONTHS / 12;
  const monthDay = today.slice(5);
  const day = monthDay === "02-29" ? "02-28" : monthDay;
  return `${String(year).padStart(4, "0")}-${day}`;
}

const classOf = (entry: LedgerEntry, payeeId: string | null, caregivers: ReadonlySet<string>): OutflowClass | null => {
  switch (entry.kind) {
    case "payout_confirmed":
      return payeeId !== null && caregivers.has(payeeId) ? "caregiver_pay" : "third_party_bill";
    case "purchase_captured":
      return "purchase_for_parent";
    case "settlement_payout":
      return "family_transfer";
    default:
      return null;
  }
};

/**
 * Every pool outflow in the window gets exactly one row. A payment the family
 * reversed is kept, shown as reversed, and left out of the totals. The
 * classification is a pure function of the entries and what the record knows
 * about them, so a reader can run it again and get the same list.
 */
export function classifyOutflows(entries: readonly LedgerEntry[], context: LookbackContext): LookbackSummary {
  const from = lookbackStart(context.today);
  const reversedBy = new Map(entries.filter((entry) => entry.reverses !== null).map((entry) => [entry.reverses ?? "", entry.id]));
  const rows: OutflowRow[] = [];
  for (const entry of entries) {
    if (entry.occurredOn < from || entry.occurredOn > context.today || entry.reverses !== null) continue;
    const headline = entryHeadline(entry);
    if (headline.poolFlow !== "out") continue;
    const payeeId = entry.kind === "payout_confirmed" ? headline.subject : null;
    const outflowClass = classOf(entry, payeeId, context.caregiverPayeeIds);
    if (outflowClass === null) continue;
    rows.push(rowOf(entry, outflowClass, payeeId, headline, reversedBy.get(entry.id) ?? null, context));
  }
  return summarize(rows, from, context.today);
}

function rowOf(entry: LedgerEntry, outflowClass: OutflowClass, payeeId: string | null, headline: ReturnType<typeof entryHeadline>, reversedBy: string | null, context: LookbackContext): OutflowRow {
  const reasons: LackingReason[] = [];
  const marks: OutflowMark[] = [];
  let agreementId: string | null = null;
  marks.push(entry.simulated ? "simulated" : "paypal");
  if (outflowClass === "caregiver_pay") {
    const own = context.agreements.filter((facts) => facts.payeeId === payeeId);
    const work = context.work.get(entry.id);
    // Without a known work date, the day it was paid is the only day to judge by.
    const days = work === undefined || work.dates.length === 0 ? [entry.occurredOn] : work.dates;
    const coverages = days.map((day) => workCoverage(day, own, work?.rateCentsPerHour ?? null));
    const covering = coverages.find((coverage) => coverage.kind === "covered");
    if (coverages.every((coverage) => coverage.kind === "covered") && covering?.kind === "covered") agreementId = covering.agreementId;
    for (const coverage of coverages) {
      if (coverage.kind === "undocumented") reasons.push("no_agreement");
      else if (coverage.kind === "not_covered") reasons.push(LACKING_BY_COVERAGE[coverage.reason]);
    }
    if (work !== undefined && !work.verified) marks.push("unverified_hours");
    if (work?.rateCentsPerHour != null) {
      const { judgement } = judgeRate(work.rateCentsPerHour, context.currency);
      const mark = rateMark(judgement);
      if (mark !== null) marks.push(mark);
    }
  } else if (outflowClass === "family_transfer") {
    reasons.push("family_transfer");
  } else if (!context.documented.has(entry.id)) {
    reasons.push("no_document");
  }
  const unique = [...new Set(reasons)];
  const status: OutflowStatus = reversedBy !== null ? "reversed" : unique.length === 0 ? "documented" : "needs_documentation";
  return {
    entryId: entry.id,
    class: outflowClass,
    status,
    reasons: reversedBy !== null ? [] : unique,
    marks,
    occurredOn: entry.occurredOn,
    cents: headline.cents,
    subject: headline.subject,
    simulated: entry.simulated,
    agreementId,
    reversedBy,
  };
}

const LACKING_BY_COVERAGE: Readonly<Record<NotCoveredReason, LackingReason>> = {
  unsigned: "agreement_unsigned",
  before_signed: "before_agreement",
  after_end: "after_agreement",
  rate_differs: "rate_not_agreed",
};

function rateMark(judgement: RateJudgement): OutflowMark | null {
  return judgement === "below" ? "rate_below_market" : judgement === "above" ? "rate_above_market" : null;
}

function summarize(rows: readonly OutflowRow[], from: string, to: string): LookbackSummary {
  const counted = rows.filter((row) => row.status !== "reversed");
  const lacking = counted.filter((row) => row.status === "needs_documentation");
  const byClass = Object.fromEntries(
    OUTFLOW_CLASSES.map((each) => {
      const own = counted.filter((row) => row.class === each);
      return [each, { count: own.length, cents: sumCents(own.map((row) => row.cents)), lackingCents: sumCents(own.filter((row) => row.status === "needs_documentation").map((row) => row.cents)) }];
    }),
  ) as LookbackSummary["byClass"];
  const lackingCents = sumCents(lacking.map((row) => row.cents));
  const outflowCents = sumCents(counted.map((row) => row.cents));
  return { from, to, rows, outflowCents, documentedCents: outflowCents - lackingCents, lackingCents, byClass };
}
