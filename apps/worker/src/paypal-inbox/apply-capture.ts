import { recordContribution, type ContributionOutcome, type Transaction } from "@kin/db";
import type { Capture } from "@kin/paypal";

export type CaptureOutcome = ContributionOutcome | "not_completed" | "other_circle";

/**
 * Applies a capture read back from PayPal to one circle's ledger. Only a
 * completed capture that names this circle is money that arrived for it.
 */
export async function applyCapture(tx: Transaction, circleId: string, capture: Capture): Promise<CaptureOutcome> {
  if (capture.reference === null || capture.reference.circleId !== circleId) return "other_circle";
  if (capture.status !== "COMPLETED") return "not_completed";
  return recordContribution(tx, circleId, {
    captureId: capture.id,
    memberId: capture.reference.memberId,
    gross: capture.gross,
    fee: capture.fee,
    capturedAt: capture.createdAt,
  });
}
