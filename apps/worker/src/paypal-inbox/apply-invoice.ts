import {
  asService,
  followInvoiceCancelled,
  readInvoiceRequest,
  recordInvoicePayment,
  recordSimulatedInvoicePayment,
  type ContributionOutcome,
  type Database,
  type InvoiceRequestKey,
} from "@kin/db";
import type { Capture, PayPalPool } from "@kin/paypal";

export type InvoiceOutcome =
  | { readonly result: "invoice_synced"; readonly circleId: string; readonly status: string; readonly payments: readonly ContributionOutcome[] }
  /**
   * No such request in this circle; PayPal's invoice belongs to another circle
   * or request; or PayPal says it was paid but its capture does not bear that
   * out (`unconfirmed`, left for a person, and retried by the next read).
   */
  | { readonly result: "failed"; readonly circleId: string; readonly reason: "unknown_invoice" | "other_circle" | "unconfirmed" };

/**
 * Brings one request for money by invoice in line with the truth. A demo
 * circle's simulated request has no PayPal behind it: its stand-in member
 * pays it at once, recorded as simulated. A real one is read back from
 * PayPal: once PayPal says it is paid, each PayPal payment on it is read back
 * as a capture, which must be completed and name this invoice, and the member
 * is credited with it exactly as a top-up is (once, by the capture's ID, with
 * PayPal's fee). PayPal's word that an invoice was cancelled ends the request.
 * If PayPal cannot be reached this throws, and the message is tried again.
 */
export async function syncInvoice({ db, pool }: { readonly db: Database; readonly pool: PayPalPool }, circleId: string, key: InvoiceRequestKey): Promise<InvoiceOutcome> {
  const request = await asService(db, circleId, (tx) => readInvoiceRequest(tx, circleId, key));
  if (request === null) return { result: "failed", circleId, reason: "unknown_invoice" };
  if (request.simulated) {
    if (request.state !== "sent") return { result: "invoice_synced", circleId, status: request.state, payments: [] };
    const outcome = await asService(db, circleId, (tx) => recordSimulatedInvoicePayment(tx, circleId, request));
    return { result: "invoice_synced", circleId, status: "paid", payments: [outcome] };
  }
  if (request.paypalInvoiceId === null) return { result: "invoice_synced", circleId, status: request.state, payments: [] };
  const invoice = await pool.getInvoice(request.paypalInvoiceId);
  if (invoice.reference?.circleId !== circleId || invoice.reference.requestId !== request.id) return { result: "failed", circleId, reason: "other_circle" };

  if (invoice.status === "CANCELLED") {
    await asService(db, circleId, (tx) => followInvoiceCancelled(tx, circleId, request));
    return { result: "invoice_synced", circleId, status: invoice.status, payments: [] };
  }
  // A payment the invoicer only recorded by hand is not money Kin saw arrive; only PayPal's own payments count.
  const paymentIds = invoice.status === "PAID" ? invoice.payments.flatMap((payment) => (payment.paymentId === null ? [] : [payment.paymentId])) : [];
  if (paymentIds.length === 0) return { result: "invoice_synced", circleId, status: invoice.status, payments: [] };

  const captures: Capture[] = [];
  for (const paymentId of paymentIds) captures.push(await pool.getCapture(paymentId));
  const confirmed = captures.every((capture) => capture.status === "COMPLETED" && capture.invoiceId === invoice.id);
  const paidCents = captures.reduce((sum, capture) => sum + capture.gross.cents, 0);
  if (!confirmed || paidCents !== request.amount.cents) return { result: "failed", circleId, reason: "unconfirmed" };

  const payments = await asService(db, circleId, async (tx) => {
    const outcomes: ContributionOutcome[] = [];
    let current = request;
    for (const capture of captures) {
      outcomes.push(await recordInvoicePayment(tx, circleId, current, { paymentId: capture.id, gross: capture.gross, fee: capture.fee, paidAt: capture.createdAt, simulated: false }));
      // The request is closed by its first payment; any other is credited and leaves it paid.
      current = { ...current, state: "paid" };
    }
    return outcomes;
  });
  return { result: "invoice_synced", circleId, status: invoice.status, payments };
}
