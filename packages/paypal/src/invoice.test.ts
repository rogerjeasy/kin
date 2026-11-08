import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseCapture } from "./capture.ts";
import { createPayPalClient, type Fetch } from "./client.ts";
import { encodeInvoiceReference, invoiceBody, invoiceNumberFor, isInvoiceId, parseInvoice, parseInvoiceCreated, parseInvoiceReference } from "./invoice.ts";
import { inboxDeduplicationId, inboxGroup, parseInboxMessage } from "./inbox.ts";
import { PayPalShapeError } from "./json.ts";
import { paypalPool } from "./pool.ts";
import { parseWebhookEnvelope, WEBHOOK_EVENT_TYPES } from "./webhook.ts";

type Recording = { created: unknown; duplicateNumber: unknown; search: unknown; draft: unknown; sent: unknown; paid: unknown; capture: unknown };
const recording = JSON.parse(readFileSync(new URL("./fixtures/invoice-sandbox-2026-11-08.json", import.meta.url), "utf8")) as Recording;

const INVOICE_ID = "INV2-YB8W-YH4M-95PN-B53B";
const reference = { circleId: "39bf803c-b946-440a-a9cc-083b1f616dae", requestId: "1a0ad39a-2fb9-439f-a970-981c9d91533b" };
const invoice = {
  number: invoiceNumberFor(reference.requestId),
  amount: { cents: 16_600, currency: "USD" },
  recipientEmail: "member@personal.example.com",
  reference,
  itemName: "Share of care costs",
  note: "Your share of October",
};

/** The pool over a client whose PayPal answers with `replies`, in order. */
function poolAnswering(replies: { status: number; body: unknown }[]) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetch: Fetch = async (url, init) => {
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token", expires_in: 32_400 });
    sent.push({ url, init });
    const reply = replies.shift();
    if (!reply) throw new Error(`Unexpected call to ${url}`);
    return new Response(reply.body === null ? null : JSON.stringify(reply.body), { status: reply.status });
  };
  const client = createPayPalClient({ apiUrl: "https://paypal.test", clientId: "id", clientSecret: "secret", fetch, now: () => new Date("2026-11-08T09:00:00Z"), sleep: async () => {}, log: () => {} });
  return { pool: paypalPool(client, "webhook"), sent };
}

describe("an invoice from the pool", () => {
  it("asks for the whole amount on one line, due on receipt, with Kin's number and private reference", () => {
    expect(JSON.parse(invoiceBody(invoice))).toEqual({
      detail: {
        currency_code: "USD",
        invoice_number: "KIN-1A0AD39A2FB9439FA9709",
        note: "Your share of October",
        memo: `kin-invoice1:${reference.circleId}:${reference.requestId}`,
        payment_term: { term_type: "DUE_ON_RECEIPT" },
      },
      primary_recipients: [{ billing_info: { email_address: "member@personal.example.com" } }],
      items: [{ name: "Share of care costs", quantity: "1", unit_amount: { currency_code: "USD", value: "166.00" } }],
      configuration: { allow_tip: false, partial_payment: { allow_partial_payment: false } },
    });
  });

  it("numbers an invoice from its request's row ID, within PayPal's 25 characters", () => {
    expect(invoiceNumberFor(reference.requestId)).toBe("KIN-1A0AD39A2FB9439FA9709");
    expect(invoiceNumberFor(reference.requestId)).toHaveLength(25);
    expect(() => invoiceNumberFor("not-a-row")).toThrow();
  });

  it("reads the draft's ID from the link PayPal answers a create with, and from a whole invoice", () => {
    expect(parseInvoiceCreated(recording.created)).toBe(INVOICE_ID);
    expect(parseInvoiceCreated(recording.draft)).toBe(INVOICE_ID);
    expect(() => parseInvoiceCreated({ rel: "self", href: "https://api.sandbox.paypal.com/v2/invoicing/invoices/../../evil" })).toThrow(PayPalShapeError);
  });

  it("creates with the request ID, and finds the first draft by its number when PayPal refuses the number as a duplicate", async () => {
    const first = poolAnswering([{ status: 201, body: recording.created }]);
    expect(await first.pool.createInvoice(invoice, "kin-invoice-create-1")).toEqual({ invoiceId: INVOICE_ID });
    expect(new Headers(first.sent[0]?.init.headers).get("PayPal-Request-Id")).toBe("kin-invoice-create-1");

    const again = poolAnswering([{ status: 422, body: recording.duplicateNumber }, { status: 200, body: recording.search }]);
    expect(await again.pool.createInvoice(invoice, "kin-invoice-create-1")).toEqual({ invoiceId: INVOICE_ID });
    expect(again.sent[1]?.url).toBe("https://paypal.test/v2/invoicing/search-invoices?page=1&page_size=2");
    expect(JSON.parse(String(again.sent[1]?.init.body))).toEqual({ invoice_number: "KIN-1A0AD39A2FB9439FA9709" });
  });

  it("passes on any other refusal, and a search that does not hold the number", async () => {
    const refused = poolAnswering([{ status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INVALID_EMAIL_ADDRESS" }] } }]);
    await expect(refused.pool.createInvoice(invoice, "key")).rejects.toMatchObject({ outcome: "rejected", issue: "INVALID_EMAIL_ADDRESS" });
    const missing = poolAnswering([{ status: 422, body: recording.duplicateNumber }, { status: 200, body: { items: [] } }]);
    await expect(missing.pool.createInvoice(invoice, "key")).rejects.toThrow(PayPalShapeError);
  });

  it("sends, reads and cancels by a whitelisted ID only", async () => {
    const { pool, sent } = poolAnswering([{ status: 200, body: { rel: "payer-view" } }, { status: 200, body: recording.sent }, { status: 204, body: null }]);
    await pool.sendInvoice(INVOICE_ID, "kin-invoice-send-1");
    expect(sent[0]?.url).toBe(`https://paypal.test/v2/invoicing/invoices/${INVOICE_ID}/send`);
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({ send_to_recipient: true, send_to_invoicer: false });
    expect((await pool.getInvoice(INVOICE_ID)).status).toBe("SENT");
    await pool.cancelInvoice(INVOICE_ID, "Withdrawn", "kin-invoice-cancel-1");
    expect(sent[2]?.url).toBe(`https://paypal.test/v2/invoicing/invoices/${INVOICE_ID}/cancel`);
    await expect(pool.getInvoice("INV2-../../v1/payments")).rejects.toThrow("Not a PayPal invoice ID");
  });
});

describe("an invoice read back from PayPal", () => {
  it("reads a sent invoice: its number, its amount in integer cents, Kin's reference and the payer's page", () => {
    expect(parseInvoice(recording.sent)).toEqual({
      id: INVOICE_ID,
      number: "KIN-1A0AD39A2FB9439FA9709",
      status: "SENT",
      reference,
      amount: { cents: 16_600, currency: "USD" },
      payerUrl: "https://www.sandbox.paypal.com/invoice/p/#YB8WYH4M95PNB53B",
      payments: [],
    });
  });

  it("reads a paid invoice's payment as a capture, which names the invoice and carries PayPal's fee", () => {
    const paid = parseInvoice(recording.paid);
    expect(paid.status).toBe("PAID");
    expect(paid.payments).toEqual([{ paymentId: "7YJ40056GS034901G", viaPayPal: true, amount: { cents: 16_600, currency: "USD" } }]);
    const capture = parseCapture(recording.capture);
    expect(capture).toMatchObject({ id: "7YJ40056GS034901G", status: "COMPLETED", invoiceId: INVOICE_ID, reference: null, gross: { cents: 16_600 }, fee: { cents: 628 } });
  });

  it("names no capture for a payment the invoicer only recorded by hand", () => {
    const record = JSON.parse(JSON.stringify(recording.paid)) as { payments: { transactions: Record<string, unknown>[] } };
    record.payments.transactions = [{ type: "EXTERNAL", method: "CASH", payment_id: "EXTR-123", amount: { currency_code: "USD", value: "166.00" } }];
    expect(parseInvoice(record).payments).toEqual([{ paymentId: null, viaPayPal: false, amount: { cents: 16_600, currency: "USD" } }]);
  });

  it("refuses a payer page that is not PayPal's, and an invoice without a valid ID", () => {
    const record = JSON.parse(JSON.stringify(recording.sent)) as { detail: { metadata: Record<string, unknown> } };
    record.detail.metadata["recipient_view_url"] = "https://evil.example/pay";
    expect(parseInvoice(record).payerUrl).toBeNull();
    expect(() => parseInvoice({ ...(recording.sent as object), id: "1 OR 1=1" })).toThrow(PayPalShapeError);
  });
});

describe("an invoice reference", () => {
  it("round-trips, and reads anything else as not Kin's", () => {
    expect(parseInvoiceReference(encodeInvoiceReference(reference))).toEqual(reference);
    expect(parseInvoiceReference("kin1:39bf803c-b946-440a-a9cc-083b1f616dae:1a0ad39a-2fb9-439f-a970-981c9d91533b")).toBeNull();
    expect(parseInvoiceReference(null)).toBeNull();
    expect(() => encodeInvoiceReference({ circleId: "x", requestId: "y" })).toThrow();
  });

  it("accepts only PayPal's invoice ID shape", () => {
    expect(isInvoiceId(INVOICE_ID)).toBe(true);
    for (const bad of ["INV2-YB8W", "inv2-yb8w-yh4m-95pn-b53b", "INV2-YB8W-YH4M-95PN-B53B/cancel"]) expect(isInvoiceId(bad)).toBe(false);
  });
});

describe("invoicing webhooks", () => {
  it("are among the events the pool's webhook subscribes to", () => {
    expect(WEBHOOK_EVENT_TYPES).toEqual(expect.arrayContaining(["INVOICING.INVOICE.PAID", "INVOICING.INVOICE.CANCELLED"]));
  });

  it("name the invoice, wrapped as Invoicing v2 sends it or bare as PayPal's simulator does", () => {
    const wrapped = JSON.stringify({ id: "WH-1", event_type: "INVOICING.INVOICE.PAID", resource_type: "invoices", resource: { invoice: { id: INVOICE_ID, status: "PAID" } } });
    expect(parseWebhookEnvelope(wrapped)).toMatchObject({ eventId: "WH-1", invoiceId: INVOICE_ID, captureId: null, reference: null });
    // The body PayPal's webhook simulator answered with on 8 November 2026 (v1 shape), trimmed.
    const simulated = JSON.stringify({ id: "WH-0T490472X6099635W-7LJ29748BW389372K", event_type: "INVOICING.INVOICE.PAID", resource_type: "invoices", resource: { id: "INV2-8FSD-3HT6-BRHR-UHYV", status: "PAID", number: "MM00063" } });
    expect(parseWebhookEnvelope(simulated).invoiceId).toBe("INV2-8FSD-3HT6-BRHR-UHYV");
    const forged = JSON.stringify({ id: "WH-2", event_type: "INVOICING.INVOICE.PAID", resource: { invoice: { id: "../../v1/x" } } });
    expect(parseWebhookEnvelope(forged).invoiceId).toBeNull();
  });
});

describe("the worker's message to read a request back", () => {
  const message = { kind: "invoice_checked", circleId: reference.circleId, invoiceRequestId: reference.requestId, requestId: "0b6f4c3e-8d1a-4f6e-9c2b-5a7d3e1f9a40" } as const;

  it("round-trips, is grouped under its circle, and keeps repeated asks apart", () => {
    expect(parseInboxMessage(JSON.stringify(message))).toEqual(message);
    expect(inboxGroup(message)).toBe(reference.circleId);
    expect(inboxDeduplicationId(message)).toBe("invoice-0b6f4c3e-8d1a-4f6e-9c2b-5a7d3e1f9a40");
  });

  it("is refused unless every ID is one of Kin's", () => {
    for (const bad of [{ ...message, circleId: "x" }, { ...message, invoiceRequestId: "INV2-YB8W-YH4M-95PN-B53B" }, { ...message, requestId: 1 }]) {
      expect(parseInboxMessage(JSON.stringify(bad))).toBeNull();
    }
  });
});
