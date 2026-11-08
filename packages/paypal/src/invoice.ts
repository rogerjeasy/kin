import { decimalAmount, type Money } from "@kin/domain";

import { moneyOf } from "./capture.ts";
import { UUID_PATTERN } from "./contribution-reference.ts";
import { asRecord, optionalRecord, optionalText, PayPalShapeError, recordList, type JsonRecord } from "./json.ts";
import { paypalPage } from "./subscription.ts";

/**
 * Which circle and which of Kin's invoice requests a PayPal invoice belongs
 * to, carried in the invoice's private memo (the invoicer reads it, the payer
 * never sees or edits it). Kin trusts it only on an invoice it read back from
 * PayPal itself.
 */
export type InvoiceReference = { readonly circleId: string; readonly requestId: string };

const VERSION = "kin-invoice1";
const REFERENCE = new RegExp(`^${VERSION}:(${UUID_PATTERN}):(${UUID_PATTERN})$`);

export function encodeInvoiceReference(reference: InvoiceReference): string {
  const text = `${VERSION}:${reference.circleId}:${reference.requestId}`;
  if (!REFERENCE.test(text)) throw new Error("An invoice reference needs a circle ID and a request ID");
  return text;
}

/** The reference in an invoice's memo, or `null` when it is not one of Kin's. */
export function parseInvoiceReference(memo: string | null): InvoiceReference | null {
  const match = memo === null ? null : REFERENCE.exec(memo);
  const circleId = match?.[1];
  const requestId = match?.[2];
  return circleId === undefined || requestId === undefined ? null : { circleId, requestId };
}

const INVOICE_ID = /^INV2(-[A-Z0-9]{4}){4}$/;

/** Whether `id` has the shape of a PayPal Invoicing v2 ID, which goes into URL paths. */
export function isInvoiceId(id: string): boolean {
  return INVOICE_ID.test(id);
}

/**
 * The invoice number Kin gives a request's invoice: `KIN-` and the first 21
 * hex digits of the request's row ID (PayPal allows 25 characters). PayPal
 * makes a second invoice for a repeated PayPal-Request-Id, but refuses a
 * number it already holds (DUPLICATE_INVOICE_NUMBER; both seen in the sandbox
 * on 8 November 2026), so this number is what makes creating idempotent.
 */
export function invoiceNumberFor(requestId: string): string {
  if (!new RegExp(`^${UUID_PATTERN}$`).test(requestId)) throw new Error("An invoice number is made from a request's row ID");
  return `KIN-${requestId.replaceAll("-", "").slice(0, 21).toUpperCase()}`;
}

export type NewInvoice = {
  /** From `invoiceNumberFor`: one invoice number for each of Kin's requests. */
  readonly number: string;
  readonly amount: Money;
  /** The member's PayPal email. PayPal emails the invoice there. */
  readonly recipientEmail: string;
  readonly reference: InvoiceReference;
  /** The one line on the invoice, such as "Share of Rose's care, October 2026". */
  readonly itemName: string;
  /** What the payer reads above the amount. */
  readonly note: string;
};

/**
 * The Invoicing v2 draft for one request: one line for the whole amount, due
 * on receipt, no tip and no partial payment, so a paid invoice is always the
 * whole amount Kin asked for. PayPal fills in the invoicer from the pool's
 * own account and numbers the invoice itself.
 */
export function invoiceBody(invoice: NewInvoice): string {
  const value = decimalAmount(invoice.amount);
  return JSON.stringify({
    detail: {
      currency_code: invoice.amount.currency,
      invoice_number: invoice.number,
      note: invoice.note.slice(0, 4000),
      memo: encodeInvoiceReference(invoice.reference),
      payment_term: { term_type: "DUE_ON_RECEIPT" },
    },
    primary_recipients: [{ billing_info: { email_address: invoice.recipientEmail } }],
    items: [{ name: invoice.itemName.slice(0, 200), quantity: "1", unit_amount: { currency_code: invoice.amount.currency, value } }],
    configuration: { allow_tip: false, partial_payment: { allow_partial_payment: false } },
  });
}

/** The search for the one invoice holding a number, after PayPal refused that number as a duplicate. */
export function numberSearchBody(number: string): string {
  return JSON.stringify({ invoice_number: number });
}

/** The ID of the invoice with exactly this number in a search's answer. */
export function parseNumberSearch(value: unknown, number: string): string {
  const match = recordList(asRecord(value, "invoice search")["items"]).find((item) => optionalText(optionalRecord(item["detail"]), "invoice_number") === number);
  const id = match === undefined ? null : optionalText(match, "id");
  if (id === null || !isInvoiceId(id)) throw new PayPalShapeError("invoice holding the number");
  return id;
}

/** PayPal emails the invoice to the member, and not a copy to the pool. */
export const SEND_BODY = JSON.stringify({ send_to_recipient: true, send_to_invoicer: false });

/** The body of a cancel call: the member is told the request is withdrawn. */
export function cancelBody(note: string): string {
  return JSON.stringify({ send_to_recipient: true, send_to_invoicer: false, note: note.slice(0, 4000) });
}

/**
 * The ID of a draft PayPal made. PayPal answers a create with the whole
 * invoice when asked for a representation, and otherwise with a link to it
 * (both seen in the sandbox on 8 November 2026), so either is read.
 */
export function parseInvoiceCreated(value: unknown): string {
  const record = asRecord(value, "created invoice");
  const id = optionalText(record, "id") ?? lastSegment(optionalText(record, "href"));
  if (id === null || !isInvoiceId(id)) throw new PayPalShapeError("invoice id");
  return id;
}

function lastSegment(href: string | null): string | null {
  if (href === null) return null;
  try {
    return new URL(href).pathname.split("/").at(-1) ?? null;
  } catch {
    return null;
  }
}

/** PayPal's invoice statuses. Only `PAID` with a completed PayPal capture is money that arrived. */
export type InvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "SCHEDULED"
  | "UNPAID"
  | "PAYMENT_PENDING"
  | "PARTIALLY_PAID"
  | "PAID"
  | "MARKED_AS_PAID"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "MARKED_AS_REFUNDED"
  | "OTHER";

const STATUSES: readonly Exclude<InvoiceStatus, "OTHER">[] = [
  "DRAFT",
  "SENT",
  "SCHEDULED",
  "UNPAID",
  "PAYMENT_PENDING",
  "PARTIALLY_PAID",
  "PAID",
  "MARKED_AS_PAID",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "MARKED_AS_REFUNDED",
];

/**
 * One payment PayPal lists on an invoice. A payment through PayPal names a
 * capture (`paymentId`), which Kin reads back for the amount and PayPal's
 * fee; one the invoicer only recorded by hand (cash, a cheque) names none and
 * is never money Kin saw arrive.
 */
export type InvoicePayment = { readonly paymentId: string | null; readonly viaPayPal: boolean; readonly amount: Money };

export type Invoice = {
  readonly id: string;
  /** PayPal's own number for it, as the payer sees it. */
  readonly number: string | null;
  readonly status: InvoiceStatus;
  readonly reference: InvoiceReference | null;
  readonly amount: Money;
  /** Where the payer views and pays it on PayPal. */
  readonly payerUrl: string | null;
  readonly payments: readonly InvoicePayment[];
};

/** Reads an invoice from PayPal's JSON, with every payment listed on it. */
export function parseInvoice(value: unknown): Invoice {
  const record = asRecord(value, "invoice");
  const id = optionalText(record, "id");
  if (id === null || !isInvoiceId(id)) throw new PayPalShapeError("invoice id");
  const status = optionalText(record, "status");
  const detail = optionalRecord(record["detail"]);
  const metadata = optionalRecord(detail?.["metadata"]);
  const viewUrl = optionalText(metadata, "recipient_view_url");
  return {
    id,
    number: optionalText(detail, "invoice_number"),
    status: STATUSES.find((each) => each === status) ?? "OTHER",
    reference: parseInvoiceReference(optionalText(detail, "memo")),
    amount: moneyOf(asRecord(record["amount"], "invoice amount"), "invoice amount"),
    payerUrl: viewUrl === null ? null : paypalPage(viewUrl),
    payments: recordList(optionalRecord(record["payments"])?.["transactions"]).map(paymentOf),
  };
}

function paymentOf(transaction: JsonRecord): InvoicePayment {
  const viaPayPal = optionalText(transaction, "method") === "PAYPAL" || optionalText(transaction, "type") === "PAYPAL";
  return {
    paymentId: viaPayPal ? optionalText(transaction, "payment_id") : null,
    viaPayPal,
    amount: moneyOf(asRecord(transaction["amount"], "invoice payment amount"), "invoice payment amount"),
  };
}
