/** What PayPal's own record says about one payment out of the care account, or why Kin has none to show. */
export type PaymentProof = {
  readonly entryId: string;
  /** PayPal's payout item, from Kin's own execution record. `null` for a payment with none. */
  readonly itemId: string | null;
  /**
   * `paypal`: PayPal's Transaction Search was read and answered. `not_yet_listed`: it was read and did not list a
   * payment made today or yesterday, which PayPal can take up to three hours to do. `not_found`: it was read and did
   * not list an older one. `unread`: Kin could not read it just now, or this deployment has no PayPal app.
   * `simulated`: no PayPal transaction stands behind it.
   */
  readonly source: "paypal" | "not_yet_listed" | "not_found" | "unread" | "simulated";
  readonly transactionId: string | null;
  /** PayPal's status code ("S" for success), as PayPal wrote it. */
  readonly status: string | null;
  /** Signed, in cents: negative when the money left the care account. */
  readonly amountCents: number | null;
  readonly currency: string | null;
  readonly at: string | null;
  /** Whether PayPal's own record shows the money leaving the care account. `null` when PayPal was not read. */
  readonly leftThePool: boolean | null;
  /** Where it went, masked by the adapter. */
  readonly counterparty: string | null;
};
