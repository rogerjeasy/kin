import {
  InvoiceRequestError,
  asPerson,
  closeInvoiceRequest,
  markInvoiceSent,
  requestInvoice,
  type CircleSnapshot,
  type Database,
  type InvoiceRequestReason,
  type InvoiceRequestRecord,
  type InvoiceRequestRow,
} from "@kin/db";
import { INVOICE_PURPOSES, InvalidDecimalError, centsFromDecimal, checkInvoiceRequest, invoiceRequestIsOpen, type InvoicePurpose, type InvoiceRequestCheck } from "@kin/domain";
import { PayPalError, invoiceNumberFor, type Inbox, type Invoice, type PayPalPool } from "@kin/paypal";
import { randomUUID } from "node:crypto";

import { periodSettlement } from "@/content/circle/fairness";
import { openPeriod } from "@/content/circle/period";
import { typedAmount } from "@/lib/typed-amount";

import { may } from "./dashboard-context";

type Services = { readonly pool: PayPalPool; readonly inbox: Inbox };

/** The words PayPal shows the member on the invoice, in the circle's own terms. */
export type InvoiceWords = {
  readonly item: (purpose: InvoicePurpose) => string;
  readonly note: string;
  readonly cancelNote: string;
};

export type InvoiceContext = {
  readonly db: Database;
  readonly userId: string;
  readonly circle: CircleSnapshot;
  /** `null` when this deployment has no PayPal app or no queue: requests by invoice are then off. */
  readonly services: Services | null;
  /** Kin's own sandbox account, standing in for a demo circle's member, or `null` to simulate. */
  readonly demoRecipient: string | null;
  readonly words: InvoiceWords;
};

export type InvoiceFailure = "invalid" | "unavailable" | "paypal" | "paid" | InvoiceRequestReason | Extract<InvoiceRequestCheck, { ok: false }>["reason"];
export type InvoiceResult = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly reason: InvoiceFailure };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** PayPal's word that it holds the invoice and emailed it. A draft has not been sent. */
const SENT_AT_PAYPAL: readonly Invoice["status"][] = ["SENT", "UNPAID", "SCHEDULED", "PAYMENT_PENDING", "PARTIALLY_PAID", "PAID"];

/**
 * The one request boundary for asking a member for money by PayPal invoice:
 * an organizer requests what the settlement collects from a member, or a
 * top-up; withdraws a request that waits; or anyone it concerns asks for it
 * to be read back from PayPal. Nothing typed in the browser is trusted: a
 * settlement's amount is the money core's, a top-up's is read digit by digit,
 * the database rechecks both and decides where the invoice goes. PayPal is
 * asked first and Kin's record follows what PayPal says it did.
 */
export async function runInvoiceRequest(context: InvoiceContext, input: unknown): Promise<InvoiceResult> {
  const row = object(input);
  const operation = row?.["operation"];
  if (row === null || (operation !== "request" && operation !== "cancel" && operation !== "check")) return refusal("invalid");
  if (context.services === null) return refusal("unavailable");
  try {
    if (operation === "request") return await request(context, context.services, row);
    if (operation === "cancel") return await cancel(context, context.services, row);
    return await check(context, context.services, row);
  } catch (error) {
    if (error instanceof InvoiceRequestError) return refusal(error.reason);
    if (error instanceof PayPalError) return refusal("paypal");
    if (error instanceof InvalidDecimalError) return refusal("invalid");
    throw error;
  }
}

async function request(context: InvoiceContext, services: Services, row: Record<string, unknown>): Promise<InvoiceResult> {
  if (!may(context.circle, "invoice.request")) return refusal("refused");
  const purpose = INVOICE_PURPOSES.find((each) => each === row["purpose"]);
  const { id, memberId } = row;
  const keys = purpose === "top_up" ? ["operation", "id", "memberId", "purpose", "amount"] : ["operation", "id", "memberId", "purpose"];
  if (purpose === undefined || !hasOnly(row, keys) || typeof id !== "string" || !UUID.test(id) || typeof memberId !== "string" || !UUID.test(memberId)) return refusal("invalid");
  const { circle } = context;
  const currency = circle.circle.currency;
  const period = purpose === "settlement" ? openPeriod(circle) : null;
  let cents: number;
  if (purpose === "top_up") {
    if (typeof row["amount"] !== "string") return refusal("invalid");
    cents = centsFromDecimal(typedAmount(row["amount"]), currency);
  } else {
    cents = periodSettlement(circle, openPeriod(circle))?.plan.collections.find((each) => each.memberId === memberId)?.cents ?? 0;
  }
  const owed = purpose === "settlement" && cents > 0 ? cents : null;
  const checked = checkInvoiceRequest(purpose, { cents, currency }, owed);
  if (!checked.ok) return refusal(checked.reason);

  // A request PayPal never confirmed sending is resumed, under its own key, rather than refused as open.
  const waiting = circle.invoiceRequests.find((each) => each.memberId === memberId && each.purpose === purpose && each.state === "requested" && each.cents === cents && each.period === period);
  const key = waiting?.id ?? id;
  const made = await asPerson(context.db, context.userId, (tx) =>
    requestInvoice(tx, { circleId: circle.circle.id, id: key, memberId, purpose, period, cents, demoRecipient: circle.circle.demo ? context.demoRecipient : null }),
  );
  if (made.request.state !== "requested") return { ok: true, id: key };
  if (made.recipient === null) {
    // A simulated request: nothing goes to PayPal. The worker has its stand-in member pay it, labelled simulated.
    await asPerson(context.db, context.userId, (tx) => markInvoiceSent(tx, { circleId: circle.circle.id, id: key, paypalInvoiceId: null, invoiceNumber: null, payerUrl: null }));
    await tell(services.inbox, circle.circle.id, key);
    return { ok: true, id: key };
  }
  return sendToPayPal(context, services, made.request, made.recipient);
}

/**
 * Makes the draft (its number is the request's key, so a repeat finds the
 * same draft), has PayPal email it, and records it as sent only once the
 * invoice read back from PayPal says so. A draft PayPal refuses outright ends
 * the request as failed; an outage leaves it requested, to resume.
 */
async function sendToPayPal(context: InvoiceContext, services: Services, made: InvoiceRequestRow, recipient: string): Promise<InvoiceResult> {
  const circleId = context.circle.circle.id;
  let invoiceId: string;
  try {
    ({ invoiceId } = await services.pool.createInvoice(
      { number: invoiceNumberFor(made.id), amount: made.amount, recipientEmail: recipient, reference: { circleId, requestId: made.id }, itemName: context.words.item(made.purpose), note: context.words.note },
      `kin-invoice-create-${made.id}`,
    ));
  } catch (error) {
    if (error instanceof PayPalError && error.outcome === "rejected") {
      await asPerson(context.db, context.userId, (tx) => closeInvoiceRequest(tx, { circleId, id: made.id, state: "failed" }));
    }
    throw error;
  }
  try {
    await services.pool.sendInvoice(invoiceId, `kin-invoice-send-${made.id}`);
  } catch (error) {
    // A send whose answer was lost, or a repeat PayPal refuses because the invoice already went:
    // either way the invoice read back says whether it was sent.
    if (!(error instanceof PayPalError)) throw error;
  }
  const invoice = await services.pool.getInvoice(invoiceId);
  if (!SENT_AT_PAYPAL.includes(invoice.status) || invoice.reference?.requestId !== made.id) return refusal("paypal");
  await asPerson(context.db, context.userId, (tx) => markInvoiceSent(tx, { circleId, id: made.id, paypalInvoiceId: invoice.id, invoiceNumber: invoice.number, payerUrl: invoice.payerUrl }));
  await tell(services.inbox, circleId, made.id);
  return { ok: true, id: made.id };
}

async function cancel(context: InvoiceContext, services: Services, row: Record<string, unknown>): Promise<InvoiceResult> {
  if (!may(context.circle, "invoice.request")) return refusal("refused");
  const found = requestNamed(context.circle, row);
  if (found === null) return refusal("invalid");
  if (!invoiceRequestIsOpen(found.state)) return refusal(found.state === "paid" ? "paid" : "move");
  if (found.paypalInvoiceId !== null) {
    try {
      await services.pool.cancelInvoice(found.paypalInvoiceId, context.words.cancelNote, `kin-invoice-cancel-${found.id}`);
    } catch (error) {
      if (!(error instanceof PayPalError) || error.outcome !== "rejected") throw error;
      // PayPal would not cancel it: the invoice read back says why. A paid one stays paid.
      const invoice = await services.pool.getInvoice(found.paypalInvoiceId);
      if (invoice.status !== "CANCELLED") {
        await tell(services.inbox, context.circle.circle.id, found.id);
        return refusal(invoice.status === "PAID" ? "paid" : "paypal");
      }
    }
  }
  await asPerson(context.db, context.userId, (tx) => closeInvoiceRequest(tx, { circleId: context.circle.circle.id, id: found.id, state: "cancelled" }));
  return { ok: true, id: found.id };
}

/** Asks the worker to read the request back from PayPal. An organizer may, and so may the member asked to pay. */
async function check(context: InvoiceContext, services: Services, row: Record<string, unknown>): Promise<InvoiceResult> {
  const found = requestNamed(context.circle, row);
  if (found === null) return refusal("invalid");
  const own = found.memberId === context.circle.viewer.memberId && may(context.circle, "money.contribute");
  if (!own && !may(context.circle, "invoice.request")) return refusal("refused");
  await tell(services.inbox, context.circle.circle.id, found.id);
  return { ok: true, id: found.id };
}

function requestNamed(circle: CircleSnapshot, row: Record<string, unknown>): InvoiceRequestRecord | null {
  const { id } = row;
  if (!hasOnly(row, ["operation", "id"]) || typeof id !== "string" || !UUID.test(id)) return null;
  return circle.invoiceRequests.find((each) => each.id === id) ?? null;
}

/** Asks the worker to read the request back. PayPal's webhook says the same if this message is lost. */
async function tell(inbox: Inbox, circleId: string, invoiceRequestId: string): Promise<void> {
  try {
    await inbox.send({ kind: "invoice_checked", circleId, invoiceRequestId, requestId: randomUUID() });
  } catch (error) {
    console.error(JSON.stringify({ message: "invoice_request.inbox_unavailable", error: error instanceof Error ? error.name : "unknown" }));
  }
}

function refusal(reason: InvoiceFailure): InvoiceResult {
  return { ok: false, reason };
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function hasOnly(row: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(row).every((key) => keys.includes(key));
}
