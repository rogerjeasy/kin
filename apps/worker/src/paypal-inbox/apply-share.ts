import { asService, followPayPal, readShare, recordShareCharge, recordSimulatedMonth, type ContributionOutcome, type Database, type ShareKey } from "@kin/db";
import { shareStateOf, type PayPalPool } from "@kin/paypal";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ShareOutcome =
  | { readonly result: "share_synced"; readonly circleId: string; readonly charges: readonly ContributionOutcome[] }
  /** No such share in this circle, or PayPal's subscription belongs to another member or circle. A person must look. */
  | { readonly result: "failed"; readonly circleId: string; readonly reason: "unknown_share" | "other_circle" };

/**
 * Brings one monthly share in line with the truth. A demo circle's share has
 * no PayPal behind it, so its month is recorded as simulated, once. A real
 * share is read back from PayPal: its state, its failed charges, and every
 * completed charge since it was made, each credited once by its transaction ID
 * (the webhook and this read write the same entry, whichever comes first).
 * If PayPal cannot be reached this throws, and the message is tried again.
 */
export async function syncShare({ db, pool }: { readonly db: Database; readonly pool: PayPalPool }, circleId: string, key: ShareKey, now: Date): Promise<ShareOutcome> {
  const share = await asService(db, circleId, (tx) => readShare(tx, circleId, key));
  if (share === null) return { result: "failed", circleId, reason: "unknown_share" };
  if (share.simulated) {
    // A paused or cancelled demo share charges nothing.
    if (share.state !== "active") return { result: "share_synced", circleId, charges: [] };
    const outcome = await asService(db, circleId, (tx) => recordSimulatedMonth(tx, circleId, share));
    return { result: "share_synced", circleId, charges: [outcome] };
  }
  if (share.paypalSubscriptionId === null) return { result: "failed", circleId, reason: "unknown_share" };
  const subscription = await pool.getSubscription(share.paypalSubscriptionId);
  if (subscription.reference?.circleId !== circleId || subscription.reference.memberId !== share.memberId) return { result: "failed", circleId, reason: "other_circle" };
  const payments = await pool.listSubscriptionPayments(share.paypalSubscriptionId, new Date(share.createdAt.getTime() - DAY_MS), now);
  const charges = await asService(db, circleId, async (tx) => {
    await followPayPal(tx, circleId, share, { state: shareStateOf(subscription.status), failedPayments: subscription.failedPayments, nextBillingAt: subscription.nextBillingAt });
    const outcomes: ContributionOutcome[] = [];
    for (const payment of payments) outcomes.push(await recordShareCharge(tx, circleId, share, payment));
    return outcomes;
  });
  return { result: "share_synced", circleId, charges };
}
