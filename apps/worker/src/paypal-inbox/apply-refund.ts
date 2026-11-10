import { recordContributionRefund, type ContributionRefundOutcome, type Transaction } from "@kin/db";
import type { Capture, Refund } from "@kin/paypal";

export type RefundOutcome = ContributionRefundOutcome | "other_circle";

/**
 * Applies a refund, and the capture it returns, both read back from PayPal,
 * to one circle's ledger. Only a capture that names this circle can have its
 * contribution reversed here.
 */
export async function applyRefund(tx: Transaction, circleId: string, capture: Capture, refund: Refund): Promise<RefundOutcome> {
  if (capture.reference === null || capture.reference.circleId !== circleId || refund.captureId !== capture.id) return "other_circle";
  return recordContributionRefund(tx, circleId, {
    captureId: capture.id,
    refundId: refund.id,
    completed: refund.status === "COMPLETED",
    wholeCaptureRefunded: capture.status === "REFUNDED",
    refunded: refund.gross,
    feeReturned: refund.feeReturned,
    net: refund.net,
    totalRefunded: refund.totalRefunded,
    refundedAt: refund.createdAt,
  });
}
