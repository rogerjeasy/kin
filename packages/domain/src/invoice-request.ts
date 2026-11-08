import type { Money } from "./money.ts";
import { checkTopUp } from "./top-up.ts";

/**
 * A request for money sent to a member as a PayPal invoice from the pool
 * (docs/architecture.md section 8.4, "Requests by invoice"). An organizer
 * raises it; PayPal emails the member, who pays from the email. Kin records
 * the money only once it has read the paid invoice and its capture back from
 * PayPal. A demo circle's request may be simulated, and says so.
 *
 * `requested`: Kin holds the row; PayPal has not yet sent the invoice.
 * `sent`: PayPal has the invoice and emailed it to the member.
 * `paid`: PayPal says it was paid, and the payment is in the ledger.
 * `cancelled`: the organizer withdrew it, or PayPal says it was cancelled.
 * `failed`: PayPal refused to make or send it. Nothing was asked of anyone.
 */
export const INVOICE_REQUEST_TRANSITIONS = {
  requested: ["sent", "failed", "cancelled"],
  sent: ["paid", "cancelled"],
  paid: [],
  cancelled: [],
  failed: [],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type InvoiceRequestState = keyof typeof INVOICE_REQUEST_TRANSITIONS;

export const INVOICE_REQUEST_STATES = Object.keys(INVOICE_REQUEST_TRANSITIONS) as [InvoiceRequestState, ...InvoiceRequestState[]];

/**
 * Why the member is asked: the amount the month's settlement plan collects
 * from them, or a top-up the organizer asks for.
 */
export const INVOICE_PURPOSES = ["settlement", "top_up"] as const;
export type InvoicePurpose = (typeof INVOICE_PURPOSES)[number];

/** Whether a request may move from one state to another. Staying put is not a move. */
export function invoiceRequestMayMove(from: InvoiceRequestState, to: InvoiceRequestState): boolean {
  return (INVOICE_REQUEST_TRANSITIONS[from] as readonly InvoiceRequestState[]).includes(to);
}

/** A request still waits on the member: it may yet be paid. */
export function invoiceRequestIsOpen(state: InvoiceRequestState): boolean {
  return state === "requested" || state === "sent";
}

export type InvoiceRequestCheck = { readonly ok: true } | { readonly ok: false; readonly reason: "currency" | "too_small" | "too_large" | "not_owed" };

/**
 * Whether `amount` may be asked of a member. A top-up request keeps a
 * top-up's limits. A settlement request must be exactly what the money core's
 * plan collects from that member (`owedCents`, `null` when the plan collects
 * nothing from them), so nobody is invoiced for a figure typed by hand.
 */
export function checkInvoiceRequest(purpose: InvoicePurpose, amount: Money, owedCents: number | null): InvoiceRequestCheck {
  if (purpose === "top_up") return checkTopUp(amount);
  if (owedCents === null || !Number.isSafeInteger(amount.cents) || amount.cents <= 0 || amount.cents !== owedCents) return { ok: false, reason: "not_owed" };
  return { ok: true };
}
