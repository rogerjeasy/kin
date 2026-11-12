import { OpenKinError, agencyInvoiceStatus, receiveAgencyInvoice } from "@kin/db";
import { AGENCY_INVOICE_SCHEMA, parseAgencyInvoice } from "@kin/domain";

import { agencyReply as reply, jsonOrUndefined, verifyAgencyRequest, type AgencyServices } from "./agency";

/**
 * A home-care agency's invoices through the same signed API as its visits
 * (docs/architecture.md section 13.5, decision 111). An invoice is verified
 * with the same signature check, kept with its raw body, and becomes a bill
 * on the family's Bills screen. It pays nothing: a person reviews it, and the
 * agreement's yeses decide whether PayPal pays it.
 */

/** The largest invoice read: a hundred lines are about ten kilobytes. */
export const MAX_INVOICE_BYTES = 65_536;

/** What Kin tells the agency an invoice is, every time, so no integration can mistake it for a payment. */
const REVIEW_NOTE = "Kept as a bill for the family to review against the visits it confirmed. Nothing is paid until a person in Kin reviews it and the family says yes; then only through PayPal to the address the family confirms.";

const REFUSALS: Readonly<Record<string, string>> = {
  shape: "The body is not an invoice Kin can read. See the OpenAPI document.",
  total: "The total is not the sum of the lines, in integer minor units.",
  currency: "Every line must be in the invoice's currency.",
  duplicate_line: "A visit appears on more than one line.",
  period: "The period or the due date is not a real date range of at most 92 days.",
  unknown_visit: "A line names a visit this agency never reported to the circle. Report it through POST /api/v1/visits first.",
  visit_invoiced: "A line names a visit already on another invoice the family has not declined.",
  circle_currency: "The invoice is not in the circle's currency.",
};

/**
 * `POST /api/v1/invoices`: one invoice, signed with the agency's key. The
 * signature is checked before anything is kept; then the raw body is kept,
 * and an invoice Kin cannot accept is kept as refused and answered 422.
 */
export async function receiveInvoice(request: Request, services: AgencyServices): Promise<Response> {
  const verified = await verifyAgencyRequest(request, services, { maxBytes: MAX_INVOICE_BYTES });
  if (verified instanceof Response) return verified;
  const { keyId, secretHash, signed: rawBody } = verified;
  const json = jsonOrUndefined(rawBody);
  const parsed = json === undefined ? ({ ok: false, reason: "shape" } as const) : parseAgencyInvoice(json);
  try {
    const received = await receiveAgencyInvoice(services.db, { keyId, secretHash, rawBody, parsed });
    if (received.state === "refused") {
      return reply(422, { id: received.id, status: "refused", reason: received.refusal, visits: received.visits, message: REFUSALS[received.refusal] ?? REFUSALS["shape"] });
    }
    return reply(received.duplicate ? 200 : 201, { id: received.id, status: "received", duplicate: received.duplicate, note: REVIEW_NOTE });
  } catch (error) {
    if (!(error instanceof OpenKinError)) throw error;
    if (error.reason === "invoice_conflict") return reply(409, { error: "conflict", message: "This invoiceNumber was sent before with a different body." });
    if (error.reason === "too_many_invoices") return reply(429, { error: "too_many_requests", message: "Too many invoices from this key today." });
    return reply(401, { error: "unauthorized", message: "This key is not live." });
  }
}

const NUMBER = new RegExp(AGENCY_INVOICE_SCHEMA.properties.invoiceNumber.pattern, "u");
const MAX_NUMBER = AGENCY_INVOICE_SCHEMA.properties.invoiceNumber.maxLength;

/**
 * `GET /api/v1/invoices/{number}`: where one of the agency's invoices stands,
 * signed like a POST with the request's path in place of the body. Only the
 * status, the total and the payout's state: nothing else about the family.
 */
export async function invoiceStatus(request: Request, invoiceNumber: string, services: AgencyServices): Promise<Response> {
  const verified = await verifyAgencyRequest(request, services, "path");
  if (verified instanceof Response) return verified;
  if (invoiceNumber.length > MAX_NUMBER || !NUMBER.test(invoiceNumber)) return reply(404, { error: "not_found", message: "No invoice from this key has that number." });
  try {
    const status = await agencyInvoiceStatus(services.db, { keyId: verified.keyId, secretHash: verified.secretHash, invoiceNumber });
    if (status === null) return reply(404, { error: "not_found", message: "No invoice from this key has that number." });
    return reply(200, status);
  } catch (error) {
    if (!(error instanceof OpenKinError)) throw error;
    return reply(401, { error: "unauthorized", message: "This key is not live." });
  }
}
