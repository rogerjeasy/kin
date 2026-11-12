import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { at, cents, circleId, id } from "./columns.ts";
import { circles } from "./circles.ts";
import { AGENCY_REPORT_STATES, agencyKeys, agencyVisitReports } from "./open-kin.ts";
import { bills } from "./payees.ts";

/**
 * Invoices a home-care agency sends through the same signed API as its visits
 * (docs/architecture.md section 13.5, decision 111). An accepted invoice is a
 * bill on the Bills screen for a person to review; it pays nothing by itself,
 * and its status for the agency is read from that bill and its payment, never
 * stored here. Neither table is ever changed; every write is
 * `kin_private.receive_agency_invoice` (migration 0069).
 */

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * Why Kin refused an invoice: the domain's reasons (packages/domain
 * agency-invoice.ts), and the database's own: `unknown_visit`, a line for a
 * visit the agency never reported to this circle; `visit_invoiced`, a visit
 * already on another invoice the family has not declined; `circle_currency`,
 * not the circle's money.
 */
export const AGENCY_INVOICE_REFUSALS = ["shape", "total", "currency", "duplicate_line", "period", "unknown_visit", "visit_invoiced", "circle_currency"] as const;
export type AgencyInvoiceStoredRefusal = (typeof AGENCY_INVOICE_REFUSALS)[number];

export const agencyInvoices = pgTable(
  "agency_invoices",
  {
    id: id(),
    circleId: circleId(),
    agencyKeyId: uuid("agency_key_id").notNull(),
    rawBody: text("raw_body").notNull(),
    bodySha256: text("body_sha256").notNull(),
    state: text("state", { enum: AGENCY_REPORT_STATES }).notNull(),
    refusal: text("refusal", { enum: AGENCY_INVOICE_REFUSALS }),
    invoiceNumber: text("invoice_number"),
    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }),
    totalCents: cents("total_cents"),
    currency: text("currency"),
    dueOn: date("due_on", { mode: "string" }),
    /** Where the agency said it takes PayPal. The reviewer still confirms it as the payee's address. */
    paypalEmail: text("paypal_email"),
    /** The bill the family reviews. */
    billId: uuid("bill_id"),
    seeded: boolean("seeded").notNull().default(false),
    receivedAt: at("received_at").notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({ name: "agency_invoices_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "agency_invoices_key_fk", columns: [t.circleId, t.agencyKeyId], foreignColumns: [agencyKeys.circleId, agencyKeys.id] }),
    foreignKey({ name: "agency_invoices_bill_fk", columns: [t.circleId, t.billId], foreignColumns: [bills.circleId, bills.id] }),
    unique("agency_invoices_circle_row").on(t.circleId, t.id),
    uniqueIndex("agency_invoices_number").on(t.agencyKeyId, t.invoiceNumber).where(sql`${t.invoiceNumber} is not null`),
    uniqueIndex("agency_invoices_one_per_bill").on(t.circleId, t.billId).where(sql`${t.billId} is not null`),
    index("agency_invoices_received_idx").on(t.circleId, t.receivedAt),
    check("agency_invoices_body", sql`length(${t.rawBody}) between 1 and 65536`),
    check("agency_invoices_sha", sql`${t.bodySha256} ~ '^[0-9a-f]{64}$'`),
    check("agency_invoices_state", sql.raw(`state in (${quoted(AGENCY_REPORT_STATES)})`)),
    check("agency_invoices_refusal", sql.raw(`refusal is null or refusal in (${quoted(AGENCY_INVOICE_REFUSALS)})`)),
    // An accepted invoice has every field and its bill; a refused one says only why.
    check(
      "agency_invoices_accepted",
      sql`(${t.state} = 'accepted') = (${t.refusal} is null)
        and (${t.state} = 'refused' or (${t.invoiceNumber} is not null and ${t.periodStart} is not null and ${t.periodEnd} is not null and ${t.totalCents} is not null and ${t.currency} is not null and ${t.dueOn} is not null and ${t.billId} is not null))
        and (${t.state} = 'accepted' or (${t.invoiceNumber} is null and ${t.billId} is null and ${t.paypalEmail} is null))`,
    ),
    check("agency_invoices_number_shape", sql`${t.invoiceNumber} is null or ${t.invoiceNumber} ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$'`),
    check("agency_invoices_total", sql`${t.totalCents} is null or (${t.totalCents} > 0 and ${t.totalCents} <= 9007199254740991)`),
    check("agency_invoices_currency", sql`${t.currency} is null or ${t.currency} ~ '^[A-Z]{3}$'`),
    check("agency_invoices_period", sql`${t.periodEnd} is null or (${t.periodEnd} >= ${t.periodStart} and ${t.periodEnd} - ${t.periodStart} <= 92)`),
    check("agency_invoices_email", sql`${t.paypalEmail} is null or (length(${t.paypalEmail}) <= 127 and ${t.paypalEmail} = lower(${t.paypalEmail}) and ${t.paypalEmail} !~ '[[:space:]<>{}]')`),
  ],
);

/**
 * Which invoice holds each visit: one row per line of an accepted invoice,
 * released only when the family declines that invoice. The partial unique
 * index makes a visit sit on at most one live invoice whatever the order or
 * concurrency of requests, so no agency, under any of its keys, can bill a
 * visit twice. A row is never deleted; its release is set once.
 */
export const agencyInvoicedVisits = pgTable(
  "agency_invoiced_visits",
  {
    id: id(),
    circleId: circleId(),
    visitReportId: uuid("visit_report_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    releasedAt: at("released_at"),
  },
  (t) => [
    foreignKey({ name: "agency_invoiced_visits_visit_fk", columns: [t.circleId, t.visitReportId], foreignColumns: [agencyVisitReports.circleId, agencyVisitReports.id] }),
    foreignKey({ name: "agency_invoiced_visits_invoice_fk", columns: [t.circleId, t.invoiceId], foreignColumns: [agencyInvoices.circleId, agencyInvoices.id] }),
    uniqueIndex("agency_invoiced_visits_live").on(t.circleId, t.visitReportId).where(sql`${t.releasedAt} is null`),
    unique("agency_invoiced_visits_once").on(t.invoiceId, t.visitReportId),
  ],
);

/** One line of an accepted invoice: a visit the agency reported, the minutes and what it costs. Never changed. */
export const agencyInvoiceLines = pgTable(
  "agency_invoice_lines",
  {
    id: id(),
    circleId: circleId(),
    invoiceId: uuid("invoice_id").notNull(),
    position: integer("position").notNull(),
    visitReportId: uuid("visit_report_id").notNull(),
    minutes: integer("minutes").notNull(),
    amountCents: cents("amount_cents").notNull(),
  },
  (t) => [
    foreignKey({ name: "agency_invoice_lines_invoice_fk", columns: [t.circleId, t.invoiceId], foreignColumns: [agencyInvoices.circleId, agencyInvoices.id] }),
    foreignKey({ name: "agency_invoice_lines_visit_fk", columns: [t.circleId, t.visitReportId], foreignColumns: [agencyVisitReports.circleId, agencyVisitReports.id] }),
    unique("agency_invoice_lines_position").on(t.invoiceId, t.position),
    unique("agency_invoice_lines_visit_once").on(t.invoiceId, t.visitReportId),
    index("agency_invoice_lines_visit_idx").on(t.circleId, t.visitReportId),
    check("agency_invoice_lines_position_range", sql`${t.position} between 1 and 100`),
    check("agency_invoice_lines_minutes", sql`${t.minutes} between 1 and 1440`),
    check("agency_invoice_lines_amount", sql`${t.amountCents} > 0 and ${t.amountCents} <= 9007199254740991`),
  ],
);
