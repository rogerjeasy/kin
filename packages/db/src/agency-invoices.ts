import type { AgencyInvoice, AgencyInvoiceRefusal, AgencyInvoiceStatus, ExecutionState, ShiftKind } from "@kin/domain";
import { AGENCY_INVOICE_STATUSES } from "@kin/domain";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";

import type { Database, Transaction } from "./connection.ts";
import { openKinOperation } from "./open-kin.ts";
import { agencyInvoiceLines, agencyInvoices, agencyVisitReports, type AgencyInvoiceStoredRefusal } from "./schema/index.ts";

/**
 * Invoices a home-care agency sends through Kin's signed API
 * (docs/architecture.md section 13.5, decision 111). Receiving one keeps its
 * raw body and, when it holds up, writes a bill waiting for a person's
 * review; it never pays. Every write is an operation in `kin_private`
 * (migration 0069), refused with an `OpenKinError`.
 */

export type ReceivedInvoice =
  | { readonly id: string; readonly state: "accepted"; readonly duplicate: boolean; readonly billId: string }
  | { readonly id: string; readonly state: "refused"; readonly refusal: AgencyInvoiceStoredRefusal; readonly visits: readonly string[] };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((each): each is string => typeof each === "string") : []);

/**
 * Keeps one invoice an agency sent, under the live key whose public ID and
 * secret hash the caller verified the signature with. Runs with nobody signed
 * in. `parsed` is the domain's reading, total already recomputed; the raw
 * body is kept whatever it says.
 */
export async function receiveAgencyInvoice(
  db: Database,
  input: { readonly keyId: string; readonly secretHash: string; readonly rawBody: string; readonly parsed: { readonly ok: true; readonly invoice: AgencyInvoice } | { readonly ok: false; readonly reason: AgencyInvoiceRefusal } },
): Promise<ReceivedInvoice> {
  const invoice = input.parsed.ok ? input.parsed.invoice : null;
  const refusal = input.parsed.ok ? null : input.parsed.reason;
  return db.transaction(async (tx) => {
    const result = await openKinOperation(() =>
      tx.execute<{ received: unknown }>(
        sql`select kin_private.receive_agency_invoice(${input.keyId}, ${input.secretHash}, ${input.rawBody}, ${invoice === null ? null : JSON.stringify(invoice)}::jsonb, ${refusal}) as received`,
      ),
    );
    const raw = result.rows[0]?.received;
    if (!isObject(raw) || typeof raw["id"] !== "string") throw new Error("The agency invoice was not kept");
    if (raw["state"] === "accepted" && typeof raw["billId"] === "string") return { id: raw["id"], state: "accepted", duplicate: raw["duplicate"] === true, billId: raw["billId"] };
    if (raw["state"] === "refused" && typeof raw["refusal"] === "string") return { id: raw["id"], state: "refused", refusal: raw["refusal"] as AgencyInvoiceStoredRefusal, visits: strings(raw["visits"]) };
    throw new Error("The agency invoice was not kept");
  });
}

export type InvoiceStatusRecord = {
  readonly invoiceNumber: string;
  readonly status: AgencyInvoiceStatus;
  readonly totalCents: number;
  readonly currency: string;
  readonly receivedAt: string;
  readonly payout: { readonly state: ExecutionState; readonly paypalItemStatus: "SUCCESS" | null; readonly simulated: boolean } | null;
};

/** Where an invoice stands, for the agency whose live key sent it, or `null` for a number it never sent. Runs with nobody signed in. */
export async function agencyInvoiceStatus(db: Database, input: { readonly keyId: string; readonly secretHash: string; readonly invoiceNumber: string }): Promise<InvoiceStatusRecord | null> {
  return db.transaction(async (tx) => {
    const result = await openKinOperation(() => tx.execute<{ status: unknown }>(sql`select kin_private.agency_invoice_status(${input.keyId}, ${input.secretHash}, ${input.invoiceNumber}) as status`));
    const raw = result.rows[0]?.status;
    if (raw === null || raw === undefined) return null;
    if (!isObject(raw) || typeof raw["invoiceNumber"] !== "string" || !AGENCY_INVOICE_STATUSES.some((status) => status === raw["status"])) throw new Error("The invoice status could not be read");
    const payout = isObject(raw["payout"]) ? raw["payout"] : null;
    return {
      invoiceNumber: raw["invoiceNumber"],
      status: raw["status"] as AgencyInvoiceStatus,
      totalCents: Number(raw["totalCents"]),
      currency: String(raw["currency"]),
      receivedAt: new Date(String(raw["receivedAt"])).toISOString(),
      payout: payout === null ? null : { state: payout["state"] as ExecutionState, paypalItemStatus: payout["paypalItemStatus"] === "SUCCESS" ? "SUCCESS" : null, simulated: payout["simulated"] === true },
    };
  });
}

export type InvoiceLineRecord = {
  readonly position: number;
  readonly minutes: number;
  readonly amountCents: number;
  readonly visit: {
    readonly externalId: string | null;
    readonly caregiverName: string | null;
    readonly caregiverMemberId: string | null;
    readonly kind: ShiftKind | null;
    readonly startsAt: Date | null;
    readonly endsAt: Date | null;
  };
};

export type AgencyInvoiceRecord = {
  readonly id: string;
  readonly agencyKeyId: string;
  readonly state: "accepted" | "refused";
  readonly refusal: AgencyInvoiceStoredRefusal | null;
  readonly invoiceNumber: string | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly totalCents: number | null;
  readonly currency: string | null;
  readonly dueOn: string | null;
  readonly paypalEmail: string | null;
  readonly billId: string | null;
  readonly seeded: boolean;
  readonly receivedAt: Date;
  readonly lines: readonly InvoiceLineRecord[];
};

/** How many invoices a screen shows. */
export const AGENCY_INVOICES_SHOWN = 20;

/** The invoices agencies sent, newest first, with their lines. Row-level security decides which the person reads; the raw body is not among them. */
export async function readAgencyInvoices(tx: Transaction, circleId: string): Promise<AgencyInvoiceRecord[]> {
  const invoices = await tx
    .select({
      id: agencyInvoices.id,
      agencyKeyId: agencyInvoices.agencyKeyId,
      state: agencyInvoices.state,
      refusal: agencyInvoices.refusal,
      invoiceNumber: agencyInvoices.invoiceNumber,
      periodStart: agencyInvoices.periodStart,
      periodEnd: agencyInvoices.periodEnd,
      totalCents: agencyInvoices.totalCents,
      currency: agencyInvoices.currency,
      dueOn: agencyInvoices.dueOn,
      paypalEmail: agencyInvoices.paypalEmail,
      billId: agencyInvoices.billId,
      seeded: agencyInvoices.seeded,
      receivedAt: agencyInvoices.receivedAt,
    })
    .from(agencyInvoices)
    .where(eq(agencyInvoices.circleId, circleId))
    .orderBy(desc(agencyInvoices.receivedAt), desc(agencyInvoices.id))
    .limit(AGENCY_INVOICES_SHOWN);
  if (invoices.length === 0) return [];
  const lines = await tx
    .select({
      invoiceId: agencyInvoiceLines.invoiceId,
      position: agencyInvoiceLines.position,
      minutes: agencyInvoiceLines.minutes,
      amountCents: agencyInvoiceLines.amountCents,
      externalId: agencyVisitReports.externalId,
      caregiverName: agencyVisitReports.caregiverName,
      caregiverMemberId: agencyVisitReports.caregiverMemberId,
      kind: agencyVisitReports.kind,
      startsAt: agencyVisitReports.startsAt,
      endsAt: agencyVisitReports.endsAt,
    })
    .from(agencyInvoiceLines)
    .innerJoin(agencyVisitReports, sql`${agencyVisitReports.circleId} = ${agencyInvoiceLines.circleId} and ${agencyVisitReports.id} = ${agencyInvoiceLines.visitReportId}`)
    .where(inArray(agencyInvoiceLines.invoiceId, invoices.map((invoice) => invoice.id)))
    .orderBy(asc(agencyInvoiceLines.position));
  return invoices.map((invoice) => ({
    ...invoice,
    lines: lines
      .filter((line) => line.invoiceId === invoice.id)
      .map(({ position, minutes, amountCents, ...visit }) => ({ position, minutes, amountCents, visit: { externalId: visit.externalId, caregiverName: visit.caregiverName, caregiverMemberId: visit.caregiverMemberId, kind: visit.kind, startsAt: visit.startsAt, endsAt: visit.endsAt } })),
  }));
}
