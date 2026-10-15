/**
 * What PayPal charges to send one payout, as the settlement reserves it before
 * a payout is sent. The sandbox charged 0.25 USD on 14 October 2026
 * (docs/architecture.md section 23). The fee PayPal actually took is read back
 * from each payout and posted to the ledger; this is only the reserve.
 */
const PAYOUT_FEE_CENTS: Readonly<Record<string, number>> = { USD: 25 };

/** The fee to reserve for one payout in `currency`. Refuses a currency it does not know. */
export function payoutFeeReserve(currency: string): () => number {
  const fee = PAYOUT_FEE_CENTS[currency];
  if (fee === undefined) throw new Error(`No payout fee is known for ${currency}`);
  return () => fee;
}
