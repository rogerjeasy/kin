import { entryHeadline } from "./entry-headline.ts";
import { reverseEntry, type Correction, type LedgerEntry } from "./ledger-entry.ts";
import type { Ledger } from "./ledger.ts";
import type { Money } from "./money.ts";

/** What PayPal says about a refund of a capture, read back from PayPal itself. */
export type ContributionRefund = {
  /** The capture whose contribution the refund returns: that entry's source. */
  readonly captureId: string;
  /** The refund's own ID: the reversal's source, so it is written once. */
  readonly refundId: string;
  /** PayPal says the money went back to the payer. */
  readonly completed: boolean;
  /** PayPal says nothing is left of the capture. */
  readonly wholeCaptureRefunded: boolean;
  /** What this refund gave back to the payer. */
  readonly refunded: Money;
  /** The part of the capture's fee PayPal gave back to the pool. */
  readonly feeReturned: Money;
  /** What left the pool's balance, when PayPal says. */
  readonly net: Money | null;
  /** Everything refunded from the capture so far, when PayPal says. */
  readonly totalRefunded: Money | null;
};

/**
 * Why a refund PayPal confirmed is kept for a person instead of written. The
 * ledger records a refund only as the exact reversal of its contribution, so
 * anything a reversal cannot state truthfully waits (docs/architecture.md
 * decision 97).
 */
export const REFUND_HOLDS = [
  /** No contribution of this circle's ledger came from the capture. */
  "unknown_capture",
  /** PayPal has not finished the refund. */
  "not_completed",
  /** Part of the capture, or the last of several parts: a reversal would cancel more than went back. */
  "partial_refund",
  /** PayPal gave back a different part of the fee than it took: a reversal would misstate the pool. */
  "fee_differs",
  /** PayPal's net is not the refund less the fee it gave back, as when a platform fee is taken. */
  "breakdown",
  /** The refund is not in the contribution's currency. */
  "currency",
] as const;

export type RefundHold = (typeof REFUND_HOLDS)[number];

export type RefundDecision =
  /** The reversing entry to append: it mirrors the contribution and names it. */
  | { readonly outcome: "reverse"; readonly entry: LedgerEntry }
  /** The refund, or a reversal of the same contribution, is already in the ledger. */
  | { readonly outcome: "already_reversed" }
  | { readonly outcome: "held"; readonly reason: RefundHold };

/**
 * Decides how a refund of a member's top-up reaches the ledger. A capture
 * refunded whole in one refund, with PayPal's whole fee given back, is the
 * exact mirror of its contribution, so it becomes one reversing entry: the
 * member's credit, the pool's cash and the fee all return to what they were,
 * and fairness and the pool recompute from the ledger. Anything else is held
 * rather than written approximately, because a pool that reads more than
 * PayPal holds could pay out money that is not there (invariant 8).
 */
export function refundContribution(ledger: Ledger, refund: ContributionRefund, correction: Omit<Correction, "source">): RefundDecision {
  const original = ledger.entries.find(
    (entry) => entry.kind === "contribution" && entry.reverses === null && entry.source.type === "paypal_event" && entry.source.id === refund.captureId,
  );
  if (original === undefined) return { outcome: "held", reason: "unknown_capture" };
  const recorded = ledger.entries.some((entry) => entry.reverses === original.id || (entry.source.type === "paypal_event" && entry.source.id === refund.refundId));
  if (recorded) return { outcome: "already_reversed" };

  const hold = holdFor(original, refund);
  if (hold !== null) return { outcome: "held", reason: hold };
  return { outcome: "reverse", entry: reverseEntry(original, { ...correction, source: { type: "paypal_event", id: refund.refundId } }) };
}

function holdFor(original: LedgerEntry, refund: ContributionRefund): RefundHold | null {
  const amounts = [refund.refunded, refund.feeReturned, refund.net, refund.totalRefunded].filter((each) => each !== null);
  if (amounts.some((each) => each.currency !== original.currency)) return "currency";
  if (!refund.completed) return "not_completed";
  const { cents: grossCents, feeCents } = entryHeadline(original);
  const refundedWhole = refund.wholeCaptureRefunded && refund.refunded.cents === grossCents && (refund.totalRefunded === null || refund.totalRefunded.cents === grossCents);
  if (!refundedWhole) return "partial_refund";
  if (refund.net !== null && refund.net.cents !== refund.refunded.cents - refund.feeReturned.cents) return "breakdown";
  if (refund.feeReturned.cents !== feeCents) return "fee_differs";
  return null;
}
