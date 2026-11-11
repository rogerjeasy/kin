import type { CircleSnapshot } from "@kin/db";
import { sumCents } from "@kin/domain";

import { entryTag } from "@/components/dashboard/words/entry-words";
import type { Dictionary } from "@/i18n/dictionary";

import { memberFairness, periodSettlement } from "./fairness";
import type { CircleNames } from "./names";
import { recordEntries } from "./record";

/**
 * The circle's record as the family money studio reads it (AG Studio). The
 * server decides every row and every amount: the browser is given integer
 * cents beside the words that name them, groups and sums only whole cents, and
 * formats each figure with Kin's one money formatter. Whoever may open the
 * Record may open the studio, and they see the same entries, no more.
 */

/** One ledger entry. Every amount is integer cents in the circle's currency. */
export type StudioLedgerRow = {
  readonly id: string;
  /** The calendar day, YYYY-MM-DD. */
  readonly day: string;
  /** The month it happened in, YYYY-MM, which sorts as time does. */
  readonly month: string;
  readonly kind: string;
  readonly person: string;
  readonly category: string;
  /** The headline amount, above zero. */
  readonly amountCents: number;
  /** The amount when the entry brought cash into the pool, else zero. */
  readonly inCents: number;
  /** The amount when the entry took cash out of the pool, else zero. */
  readonly outCents: number;
  /** PayPal's fee on the movement, or zero. */
  readonly feeCents: number;
  /** The amount when the entry paid a caregiver, else zero. */
  readonly caregiverPayCents: number;
  /** The caregiver paid, or an empty string. */
  readonly caregiver: string;
  /** "PayPal sandbox" or "Simulated", in the reader's words: never presented as the same thing. */
  readonly proof: string;
  /** True when no real PayPal sandbox transaction stands behind it. */
  readonly simulated: boolean;
  /** A real PayPal sandbox event stands behind it, and the ledger recorded it only once PayPal said so. */
  readonly paypalVerified: boolean;
  /** PayPal's own ID for that event, when there is one. */
  readonly paypalId: string;
};

/** One sharing member's place in one month's settlement, as the money core calculates it. */
export type StudioFairnessRow = {
  readonly month: string;
  readonly member: string;
  /** Their agreed share, in basis points. */
  readonly shareBps: number;
  /** Their place in the agreement's order of shares: their colour on every screen. */
  readonly shareIndex: number;
  /** Everything they gave: cash, own spending and care credit. */
  readonly givenCents: number;
  /** Their agreed share of everything the circle gave. */
  readonly agreedCents: number;
  /** Above zero: the pool owes them. Below zero: they owe. */
  readonly positionCents: number;
};

/** The record in the studio: two tables, the ledger and the fairness of each month. */
export type StudioData = {
  readonly currency: string;
  readonly ledger: readonly StudioLedgerRow[];
  readonly fairness: readonly StudioFairnessRow[];
};

/** The most months of fairness the studio shows, newest first. */
export const STUDIO_FAIRNESS_MONTHS = 12;

function caregiverPayees(circle: CircleSnapshot): ReadonlySet<string> {
  return new Set(circle.payees.filter((payee) => payee.caregiverRateCentsPerHour !== null).map((payee) => payee.id));
}

export function studioLedger(circle: CircleSnapshot, dictionary: Dictionary, names: CircleNames): StudioLedgerRow[] {
  const { common } = dictionary.dashboard;
  const noCategory = dictionary.dataGrid.totals.noCategory;
  const caregivers = caregiverPayees(circle);
  return recordEntries(circle).map((view) => {
    const { entry } = view;
    const paidCaregiver = entry.kind === "payout_confirmed" && caregivers.has(view.subject);
    const verified = entry.source.type === "paypal_event" && !entry.simulated;
    return {
      id: entry.id,
      day: entry.occurredOn,
      month: entry.occurredOn.slice(0, 7),
      kind: common.entryKinds[entry.kind],
      person: entry.kind === "purchase_captured" || entry.kind === "purse_funded" || entry.kind === "purse_paid" ? names.parent : names.subject(view.subject),
      category: view.category === null ? noCategory : names.category(view.category),
      amountCents: view.cents,
      inCents: view.poolFlow === "in" ? view.cents : 0,
      outCents: view.poolFlow === "out" ? view.cents : 0,
      feeCents: view.feeCents,
      caregiverPayCents: paidCaregiver ? view.cents : 0,
      caregiver: paidCaregiver ? names.payee(view.subject) : "",
      proof: entryTag(dictionary, entry),
      simulated: entry.simulated,
      paypalVerified: verified,
      paypalId: verified ? entry.source.id : "",
    };
  });
}

/** Each month's settlement, for the months the ledger holds, newest first. Empty for a role that may not see the agreement. */
export function studioFairness(circle: CircleSnapshot, names: CircleNames): StudioFairnessRow[] {
  const months = [...new Set(circle.ledger.entries.map((entry) => entry.period))].toSorted().toReversed().slice(0, STUDIO_FAIRNESS_MONTHS);
  return months.flatMap((month) => {
    const settlement = periodSettlement(circle, month);
    if (settlement === null) return [];
    return memberFairness(settlement, circle).map(({ memberId, shareBps, shareIndex, position }) => ({
      month,
      member: names.member(memberId),
      shareBps,
      shareIndex,
      givenCents: position.contributedCents,
      agreedCents: position.targetCents,
      positionCents: position.positionCents,
    }));
  });
}

export function studioData(circle: CircleSnapshot, dictionary: Dictionary, names: CircleNames): StudioData {
  return { currency: circle.circle.currency, ledger: studioLedger(circle, dictionary, names), fairness: studioFairness(circle, names) };
}

/** The figures Kin's own summary and the studio's agent read: totals of the rows above, in whole cents. */
export type StudioTotals = {
  readonly inCents: number;
  readonly outCents: number;
  readonly feeCents: number;
  readonly caregiverPayCents: number;
  readonly sandboxEntries: number;
  readonly simulatedEntries: number;
  /** The entries PayPal confirmed, newest first. */
  readonly verified: readonly { readonly id: string; readonly day: string; readonly paypalId: string; readonly amountCents: number }[];
};

export function studioTotals(ledger: readonly StudioLedgerRow[]): StudioTotals {
  const total = (pick: (row: StudioLedgerRow) => number) => sumCents(ledger.map(pick));
  const verified = ledger.filter((row) => row.paypalVerified);
  return {
    inCents: total((row) => row.inCents),
    outCents: total((row) => row.outCents),
    feeCents: total((row) => row.feeCents),
    caregiverPayCents: total((row) => row.caregiverPayCents),
    sandboxEntries: ledger.filter((row) => !row.simulated).length,
    simulatedEntries: ledger.filter((row) => row.simulated).length,
    verified: verified.map((row) => ({ id: row.id, day: row.day, paypalId: row.paypalId, amountCents: row.amountCents })),
  };
}
