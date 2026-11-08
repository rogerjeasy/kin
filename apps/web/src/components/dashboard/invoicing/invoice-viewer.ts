import type { CircleSnapshot, InvoiceRequestRecord } from "@kin/db";

import { may } from "@/server/dashboard-context";

/**
 * Who is looking at a request, for what the screen offers them: an organizer
 * may withdraw it, the member asked may ask Kin to check it, and the rest of
 * the family reads it. The server checks the same again on every request.
 */
export function invoiceViewer(circle: CircleSnapshot, request: InvoiceRequestRecord): "organizer" | "payer" | "family" {
  if (may(circle, "invoice.request")) return "organizer";
  return request.memberId === circle.viewer.memberId && may(circle, "money.contribute") ? "payer" : "family";
}
