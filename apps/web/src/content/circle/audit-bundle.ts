import type { CircleSnapshot } from "@kin/db";
import { payoutFeeReserve } from "@kin/paypal";
import { buildBundle, claimSettlement, type AuditBundle, type SettlementClaim, type StoredHead } from "@kin/verify";

import { describeEntry } from "@/components/dashboard/words/entry-words";
import type { Dictionary } from "@/i18n/dictionary";
import type { Formatters } from "@/lib/format";

import type { CircleNames } from "./names";
import { openPeriod } from "./period";
import { entryView } from "./record";

/** What PayPal is assumed to charge for one payout; `null` for a currency the reserve does not know, so no settlement is claimed. */
function payoutFeeCents(currency: string): number | null {
  try {
    return payoutFeeReserve(currency)();
  } catch {
    return null;
  }
}

/** The settlements the export claims: one for each month with entries, worked out from the agreement in force. */
function settlementClaims(circle: CircleSnapshot): SettlementClaim[] {
  const { agreement } = circle;
  const fee = payoutFeeCents(circle.circle.currency);
  if (agreement === null || fee === null) return [];
  const periods = [...new Set(circle.ledger.entries.map((entry) => entry.period))].toSorted();
  const terms = { version: agreement.version, shares: agreement.shares, care: agreement.care, approvals: agreement.approvals };
  return periods.map((period) => claimSettlement(circle.ledger.entries, circle.ledger.circleId, circle.ledger.currency, terms, period, fee));
}

/**
 * The circle's record as an audit export: its entries in the order the ledger
 * accepted them with their hash chain, the line the screens show for each one
 * (so a second reader can check its figures), the settlements, and the heads
 * Kin kept at earlier visits so a past change cannot pass. It adds nothing
 * the circle's own ledger does not hold.
 */
export function circleBundle(circle: CircleSnapshot, dictionary: Dictionary, names: CircleNames, format: Formatters, heads: readonly StoredHead[]): AuditBundle {
  const { ledger } = circle;
  return buildBundle({
    circleId: ledger.circleId,
    currency: ledger.currency,
    generatedOn: ledger.entries.at(-1)?.occurredOn ?? `${openPeriod(circle)}-01`,
    entries: ledger.entries,
    heads,
    wording: ledger.entries.map((entry) => {
      const view = entryView(entry);
      return { entryId: entry.id, text: `${describeEntry(dictionary, names, view)}: ${format.money(view.cents)}, ${format.day(entry.occurredOn)}` };
    }),
    settlements: settlementClaims(circle),
  });
}
