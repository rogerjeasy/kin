import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { at, cents, circleId, createdAt, currency, id, periodCheck } from "./columns.ts";
import { circles, members } from "./circles.ts";
import { invoicePurpose, invoiceRequestState } from "./enums.ts";

/**
 * A request for money sent to a member as a PayPal invoice from the pool
 * (docs/architecture.md section 8.4): what the month's settlement collects
 * from them, or a top-up an organizer asks for. The row's ID is the request's
 * idempotency key and makes the invoice's number. The money itself reaches
 * the ledger as a contribution once the worker has read the paid invoice and
 * its capture back from PayPal. A demo circle's request is simulated unless
 * Kin's own sandbox account stands in for the member.
 */
export const invoiceRequests = pgTable(
  "invoice_requests",
  {
    id: id(),
    circleId: circleId(),
    /** The member asked to pay. */
    memberId: uuid("member_id").notNull(),
    /** The organizer who asked. */
    requestedBy: uuid("requested_by").notNull(),
    purpose: invoicePurpose("purpose").notNull(),
    /** The settlement's period, as YYYY-MM. A top-up request has none. */
    period: text("period"),
    amountCents: cents("amount_cents").notNull(),
    currency: currency(),
    state: invoiceRequestState("state").notNull().default("requested"),
    /** No PayPal invoice stands behind it: a demo circle's request, labelled so everywhere. */
    simulated: boolean("simulated").notNull().default(false),
    /** Where PayPal emailed the invoice. A simulated request has none. */
    recipient: text("recipient"),
    paypalInvoiceId: text("paypal_invoice_id"),
    /** The number PayPal shows the payer, Kin's own (`KIN-…`). */
    invoiceNumber: text("invoice_number"),
    /** Where the member views and pays it on PayPal. */
    payerUrl: text("payer_url"),
    /** The PayPal capture that paid it, which is also its ledger entry's source; a simulated payment's own ID. */
    paymentId: text("payment_id"),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().default(sql`now()`),
    sentAt: at("sent_at"),
    paidAt: at("paid_at"),
  },
  (t) => [
    foreignKey({ name: "invoice_requests_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "invoice_requests_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "invoice_requests_requester_fk", columns: [t.circleId, t.requestedBy], foreignColumns: [members.circleId, members.id] }),
    unique("invoice_requests_circle_row").on(t.circleId, t.id),
    unique("invoice_requests_paypal_once").on(t.paypalInvoiceId),
    unique("invoice_requests_payment_once").on(t.circleId, t.paymentId),
    // One open request at a time for each member and purpose: a second waits until the first is paid, cancelled or failed.
    uniqueIndex("invoice_requests_one_open").on(t.circleId, t.memberId, t.purpose).where(sql`${t.state} in ('requested', 'sent')`),
    index("invoice_requests_member_idx").on(t.circleId, t.memberId),
    check("invoice_requests_amount_positive", sql`${t.amountCents} > 0 and ${t.amountCents} <= 9007199254740991`),
    check("invoice_requests_period", sql`(${t.purpose} = 'settlement') = (${t.period} is not null) and (${t.period} is null or ${periodCheck("period")})`),
    check("invoice_requests_simulated_has_no_paypal", sql`not ${t.simulated} or (${t.recipient} is null and ${t.paypalInvoiceId} is null)`),
    check("invoice_requests_real_has_recipient", sql`${t.simulated} or ${t.recipient} is not null`),
    check("invoice_requests_sent_has_invoice", sql`${t.state} not in ('sent', 'paid') or ${t.simulated} or ${t.paypalInvoiceId} is not null`),
    check("invoice_requests_paid_has_payment", sql`(${t.state} = 'paid') = (${t.paymentId} is not null and ${t.paidAt} is not null)`),
    check("invoice_requests_not_to_oneself", sql`${t.memberId} <> ${t.requestedBy}`),
  ],
);
