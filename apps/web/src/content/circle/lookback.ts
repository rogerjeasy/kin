import type { CircleSnapshot, ExecutionRecord } from "@kin/db";
import {
  HOUSEHOLD_TAX_YEARS,
  entryHeadline,
  classifyOutflows,
  estimateHouseholdTax,
  quarterOf,
  shiftDay,
  type HouseholdTaxEstimate,
  type LookbackSummary,
  type OutflowRow,
  type WorkFacts,
} from "@kin/domain";

import { circleToday } from "./today";

/** One caregiver's payments in the window, with the work and the paper behind each. */
export type LookbackView = {
  readonly today: string;
  readonly summary: LookbackSummary;
  /** The work behind each caregiver payment, by ledger entry. */
  readonly work: ReadonlyMap<string, WorkFacts>;
  /** The PayPal payout item behind each payment, when the record names one. */
  readonly itemOf: ReadonlyMap<string, string>;
  readonly estimates: readonly HouseholdTaxEstimate[];
};

/**
 * The look-back for a circle: every payment out of the pool in the last 60
 * months, sorted by plain code into what it was and whether the record holds
 * the paper a reviewer asks for. The executions tie each ledger entry to its
 * approval, and the approval to the visit, bill or order behind it.
 */
export function lookbackView(circle: CircleSnapshot, executions: readonly ExecutionRecord[]): LookbackView {
  const today = circleToday(circle);
  const proposalOfItem = new Map(executions.filter((each) => each.paypalItemId !== null).map((each) => [each.paypalItemId ?? "", each.proposalId]));
  const proposals = new Map(circle.proposals.map((proposal) => [proposal.id, proposal]));
  const bills = new Map(circle.bills.map((bill) => [bill.id, bill]));
  const shiftOf = new Map(circle.shifts.flatMap((shift) => (shift.proposalId === null ? [] : [[shift.proposalId, shift] as const])));
  const purchaseOf = new Map(circle.purchases.map((purchase) => [purchase.proposalId, purchase]));

  const work = new Map<string, WorkFacts>();
  const documented = new Set<string>();
  const itemOf = new Map<string, string>();
  // A payout with no execution on record (history that came in without one) is matched to the paid bill that has the same
  // payee and amount, each bill once, so the paper behind it is still found.
  const unmatchedBills = circle.bills.filter((bill) => bill.state === "paid");
  const noteBill = (entryId: string, bill: (typeof circle.bills)[number] | undefined) => {
    if (bill?.caregiverDetails != null) {
      // A bill the caregiver wrote has service days but no visit proof behind them.
      work.set(entryId, { dates: bill.caregiverDetails.visits.map((visit) => visit.date), verified: false, rateCentsPerHour: bill.caregiverDetails.rateCentsPerHour });
    }
    if (bill?.documentId != null) documented.add(entryId);
  };
  for (const entry of circle.ledger.entries) {
    const proposalId = proposalOfItem.get(entry.source.id);
    if (proposalId === undefined) {
      if (entry.kind !== "payout_confirmed") continue;
      const { subject, cents } = entryHeadline(entry);
      const at = unmatchedBills.findIndex((bill) => bill.payeeId === subject && bill.amountCents === cents);
      if (at >= 0) noteBill(entry.id, unmatchedBills.splice(at, 1)[0]);
      continue;
    }
    itemOf.set(entry.id, entry.source.id);
    const proposal = proposals.get(proposalId);
    const shift = shiftOf.get(proposalId);
    if (shift !== undefined) {
      // A paid shift turned both keys: the caregiver's own taps and the family's word.
      work.set(entry.id, { dates: [shiftDay(shift.checkedInAt ?? shift.startsAt, circle.circle.timezone)], verified: shift.checkedInAt !== null && shift.checkedOutAt !== null && shift.familyConfirmedAt !== null, rateCentsPerHour: shift.rateCentsPerHour });
      continue;
    }
    noteBill(entry.id, proposal?.billId == null ? undefined : bills.get(proposal.billId));
    if (purchaseOf.get(proposalId)?.merchantOrder != null) documented.add(entry.id);
  }

  const caregiverPayeeIds = new Set(circle.payees.filter((payee) => payee.payee.member?.role === "caregiver").map((payee) => payee.id));
  const summary = classifyOutflows(circle.ledger.entries, {
    today,
    currency: circle.circle.currency,
    caregiverPayeeIds,
    agreements: circle.careAgreements.map((agreement) => agreement.facts),
    work,
    documented,
  });
  return { today, summary, work, itemOf, estimates: householdEstimates(summary.rows, circle) };
}

/** The household-employer estimate for each caregiver and calendar year with payments, from cash paid on the day it was paid. */
export function householdEstimates(rows: readonly OutflowRow[], circle: CircleSnapshot): HouseholdTaxEstimate[] {
  const wages = new Map<string, [number, number, number, number]>();
  for (const row of rows) {
    if (row.class !== "caregiver_pay" || row.status === "reversed") continue;
    const key = `${row.subject}|${row.occurredOn.slice(0, 4)}`;
    const quarters = wages.get(key) ?? [0, 0, 0, 0];
    quarters[quarterOf(row.occurredOn)] = (quarters[quarterOf(row.occurredOn)] ?? 0) + row.cents;
    wages.set(key, quarters);
  }
  const known = new Set(HOUSEHOLD_TAX_YEARS.map((each) => each.year));
  return [...wages]
    .map(([key, quarterCents]) => {
      const [employee = "", year = ""] = key.split("|");
      return estimateHouseholdTax({ employee: circle.payees.find((payee) => payee.id === employee)?.name ?? employee, year: Number(year), quarterCents });
    })
    .toSorted((a, b) => b.year - a.year || a.employee.localeCompare(b.employee))
    .filter((estimate) => known.has(estimate.year) || estimate.wagesCents > 0);
}
