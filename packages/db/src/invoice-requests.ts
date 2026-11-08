import { invoiceRequestMayMove, type InvoicePurpose, type InvoiceRequestState, type Money } from "@kin/domain";
import { and, eq, sql } from "drizzle-orm";

import { postgresError } from "./caregiver-billing.ts";
import type { Transaction } from "./connection.ts";
import { recordContribution, type ContributionOutcome } from "./contributions.ts";
import { circles, invoiceRequests } from "./schema/index.ts";

export type InvoiceRequestReason = "refused" | "invalid" | "open" | "no_email" | "move";

/** The database refused an invoice request. Retrying cannot help. */
export class InvoiceRequestError extends Error {
  readonly retryable = false;
  readonly reason: InvoiceRequestReason;

  constructor(reason: InvoiceRequestReason) {
    super(`Invoice request refused: ${reason}`);
    this.name = "InvoiceRequestError";
    this.reason = reason;
  }
}

const REASONS: Readonly<Record<string, InvoiceRequestReason>> = {
  "42501": "refused",
  "23514": "invalid",
  "22P02": "invalid",
  "23505": "open",
  KB014: "open",
  KB015: "move",
  KB016: "no_email",
};

async function refusals<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = REASONS[postgresError(error)?.code ?? ""];
    if (reason !== undefined) throw new InvoiceRequestError(reason);
    throw error;
  }
}

/** A request as the web app and the worker act on it. The recipient is never part of it. */
export type InvoiceRequestRow = {
  readonly id: string;
  readonly memberId: string;
  readonly purpose: InvoicePurpose;
  readonly period: string | null;
  readonly amount: Money;
  readonly state: InvoiceRequestState;
  readonly simulated: boolean;
  readonly paypalInvoiceId: string | null;
};

type StoredRow = typeof invoiceRequests.$inferSelect;

function rowOf(row: StoredRow): InvoiceRequestRow {
  return {
    id: row.id,
    memberId: row.memberId,
    purpose: row.purpose,
    period: row.period,
    amount: { cents: row.amountCents, currency: row.currency },
    state: row.state,
    simulated: row.simulated,
    paypalInvoiceId: row.paypalInvoiceId,
  };
}

export type NewInvoiceRequest = {
  readonly circleId: string;
  /** The request's own ID, made by the caller: its idempotency key. */
  readonly id: string;
  readonly memberId: string;
  readonly purpose: InvoicePurpose;
  /** The settlement's period, YYYY-MM; `null` for a top-up request. */
  readonly period: string | null;
  readonly cents: number;
  /** Kin's own sandbox account, standing in for a demo circle's member. `null` everywhere else. */
  readonly demoRecipient: string | null;
};

/**
 * An organizer's request for money by invoice. Run as the person: the
 * database rechecks the role, the member and the amount, and decides where
 * the invoice goes. Returns the row and, for an invoice PayPal will send, the
 * address it goes to (`null` for a simulated request). The same request
 * again returns the same row.
 */
export async function requestInvoice(tx: Transaction, input: NewInvoiceRequest): Promise<{ readonly request: InvoiceRequestRow; readonly recipient: string | null }> {
  return refusals(async () => {
    const result = await tx.execute<Record<string, unknown>>(
      sql`select * from kin_private.request_invoice(${input.circleId}::uuid, ${input.id}::uuid, ${input.memberId}::uuid, ${input.purpose}::public.invoice_purpose, ${input.period}, ${input.cents}::bigint, ${input.demoRecipient})`,
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("The database made no invoice request");
    return {
      request: {
        id: String(row["id"]),
        memberId: String(row["member_id"]),
        purpose: row["purpose"] as InvoicePurpose,
        period: typeof row["period"] === "string" ? row["period"] : null,
        amount: { cents: Number(row["amount_cents"]), currency: String(row["currency"]) },
        state: row["state"] as InvoiceRequestState,
        simulated: row["simulated"] === true,
        paypalInvoiceId: typeof row["paypal_invoice_id"] === "string" ? row["paypal_invoice_id"] : null,
      },
      recipient: typeof row["recipient"] === "string" ? row["recipient"] : null,
    };
  });
}

/** Records that PayPal sent the invoice, once Kin read it back as sent; a simulated request names no invoice. Run as the person. */
export async function markInvoiceSent(
  tx: Transaction,
  input: { readonly circleId: string; readonly id: string; readonly paypalInvoiceId: string | null; readonly invoiceNumber: string | null; readonly payerUrl: string | null },
): Promise<void> {
  await refusals(() =>
    tx.execute(sql`select kin_private.mark_invoice_sent(${input.circleId}::uuid, ${input.id}::uuid, ${input.paypalInvoiceId}, ${input.invoiceNumber}, ${input.payerUrl})`),
  );
}

/** Ends a request an organizer withdrew, or one PayPal refused. Run as the person. */
export async function closeInvoiceRequest(tx: Transaction, input: { readonly circleId: string; readonly id: string; readonly state: "cancelled" | "failed" }): Promise<void> {
  await refusals(() => tx.execute(sql`select kin_private.close_invoice_request(${input.circleId}::uuid, ${input.id}::uuid, ${input.state}::public.invoice_request_state)`));
}

export type InvoiceRequestKey = { readonly id: string } | { readonly paypalInvoiceId: string };

/** One circle's request by Kin's ID or PayPal's. Run inside `asService` for the circle. */
export async function readInvoiceRequest(tx: Transaction, circleId: string, key: InvoiceRequestKey): Promise<InvoiceRequestRow | null> {
  const match = "id" in key ? eq(invoiceRequests.id, key.id) : eq(invoiceRequests.paypalInvoiceId, key.paypalInvoiceId);
  const [row] = await tx.select().from(invoiceRequests).where(and(eq(invoiceRequests.circleId, circleId), match));
  return row === undefined ? null : rowOf(row);
}

/** A payment of a request's invoice: a capture PayPal confirmed, or a demo's simulated one. */
export type InvoicePaymentRecord = { readonly paymentId: string; readonly gross: Money; readonly fee: Money; readonly paidAt: Date; readonly simulated: boolean };

/**
 * Credits the member with what they paid on the invoice, exactly as a top-up
 * is credited (the money core builds the entry; the capture's ID is its
 * source, so the webhook and a direct read write it once between them), and
 * closes the request as paid in the same transaction. Run inside `asService`.
 */
export async function recordInvoicePayment(tx: Transaction, circleId: string, request: InvoiceRequestRow, payment: InvoicePaymentRecord): Promise<ContributionOutcome> {
  const outcome = await recordContribution(tx, circleId, {
    captureId: payment.paymentId,
    memberId: request.memberId,
    gross: payment.gross,
    fee: payment.fee,
    capturedAt: payment.paidAt,
    description: payment.simulated ? "Paid an invoice (simulated)" : "Paid a PayPal invoice",
    simulated: payment.simulated,
  });
  if (invoiceRequestMayMove(request.state, "paid")) {
    await tx
      .update(invoiceRequests)
      .set({ state: "paid", paymentId: payment.paymentId, paidAt: payment.paidAt })
      .where(and(eq(invoiceRequests.circleId, circleId), eq(invoiceRequests.id, request.id)));
  }
  return outcome;
}

/**
 * A demo circle's simulated invoice, paid at once by its stand-in member:
 * the amount credited, labelled simulated, with no PayPal payment behind it
 * and no fee. It never lands in a real family's ledger. Run inside `asService`.
 */
export async function recordSimulatedInvoicePayment(tx: Transaction, circleId: string, request: InvoiceRequestRow): Promise<ContributionOutcome> {
  const [circle] = await tx.select({ demo: circles.demo, clockAt: circles.clockAt }).from(circles).where(eq(circles.id, circleId));
  if (!circle?.demo || !request.simulated) throw new InvoiceRequestError("refused");
  // The demo clock, so the payment falls in the month the demo shows.
  const paidAt = circle.clockAt ?? new Date();
  return recordInvoicePayment(tx, circleId, request, {
    paymentId: `simulated-invoice-${request.id}`,
    gross: request.amount,
    fee: { cents: 0, currency: request.amount.currency },
    paidAt,
    simulated: true,
  });
}

/** PayPal says the invoice was cancelled: the request ends, if the diagram allows. Run inside `asService`. */
export async function followInvoiceCancelled(tx: Transaction, circleId: string, request: InvoiceRequestRow): Promise<void> {
  if (!invoiceRequestMayMove(request.state, "cancelled")) return;
  await tx.update(invoiceRequests).set({ state: "cancelled" }).where(and(eq(invoiceRequests.circleId, circleId), eq(invoiceRequests.id, request.id)));
}
