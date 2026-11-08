import { asPerson, asService, markInvoiceSent, readInvoiceRequest, readLedger, requestInvoice } from "@kin/db";
import { paypalEventStates, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { accountBalance, memberAccount, type LedgerEntry } from "@kin/domain";
import { invoiceNumberFor } from "@kin/paypal";
import { fakePool, type FakePool } from "@kin/paypal/testing";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { handleInboxMessage, type InboxDeps } from "./handle-message.ts";

const db = testDatabases();

type Sent = { circle: VisitorCircle; pool: FakePool; deps: InboxDeps; requestId: string; invoiceId: string };

/** Elena asks Marcus by PayPal invoice for what the settlement collects from him, and PayPal sends it. */
async function sent(cents = 16_600): Promise<Sent> {
  const circle = await visitorWithCircle(db);
  const pool = fakePool();
  const requestId = randomUUID();
  const { recipient } = await asPerson(db.app, circle.userId, (tx) =>
    requestInvoice(tx, { circleId: circle.circleId, id: requestId, memberId: circle.members.marcus, purpose: "settlement", period: "2026-10", cents, demoRecipient: "kin-member@personal.example.com" }),
  );
  if (recipient === null) throw new Error("No recipient");
  const reference = { circleId: circle.circleId, requestId };
  const { invoiceId } = await pool.createInvoice({ number: invoiceNumberFor(requestId), amount: { cents, currency: "USD" }, recipientEmail: recipient, reference, itemName: "Share", note: "October" }, `create-${requestId}`);
  await pool.sendInvoice(invoiceId, `send-${requestId}`);
  await asPerson(db.app, circle.userId, (tx) => markInvoiceSent(tx, { circleId: circle.circleId, id: requestId, paypalInvoiceId: invoiceId, invoiceNumber: invoiceNumberFor(requestId), payerUrl: null }));
  return { circle, pool, deps: { db: db.service, pool }, requestId, invoiceId };
}

const check = ({ deps, circle, requestId }: Sent) => handleInboxMessage(deps, { kind: "invoice_checked", circleId: circle.circleId, invoiceRequestId: requestId, requestId: randomUUID() });
const ledgerOf = (circleId: string) => asService(db.service, circleId, (tx) => readLedger(tx, { id: circleId, currency: "USD" }));
const invoicePayments = async (circleId: string): Promise<LedgerEntry[]> => (await ledgerOf(circleId)).entries.filter((entry) => entry.description.includes("invoice"));
const stateOf = async ({ circle, requestId }: Sent) => (await asService(db.service, circle.circleId, (tx) => readInvoiceRequest(tx, circle.circleId, { id: requestId })))?.state;

describe("a request for money by PayPal invoice, in the worker", () => {
  it("records nothing while the invoice waits to be paid", async () => {
    const request = await sent();
    expect(await check(request)).toEqual({ result: "invoice_synced", circleId: request.circle.circleId, status: "SENT", payments: [] });
    expect(await invoicePayments(request.circle.circleId)).toEqual([]);
    expect(await stateOf(request)).toBe("sent");
  });

  it("credits the member with the paid invoice once its capture is read back, with PayPal's fee, and the request ends paid", async () => {
    const request = await sent();
    const before = await ledgerOf(request.circle.circleId);
    const capture = request.pool.payInvoice(request.invoiceId);

    expect(await check(request)).toEqual({ result: "invoice_synced", circleId: request.circle.circleId, status: "PAID", payments: ["recorded"] });
    expect(await stateOf(request)).toBe("paid");
    const [entry] = await invoicePayments(request.circle.circleId);
    expect(entry).toMatchObject({ kind: "contribution", source: { type: "paypal_event", id: capture.id }, simulated: false });
    const after = await ledgerOf(request.circle.circleId);
    const marcus = memberAccount(request.circle.members.marcus);
    expect(accountBalance(after, marcus) - accountBalance(before, marcus)).toBe(16_600);
    expect(accountBalance(after, "pool_cash") - accountBalance(before, "pool_cash")).toBe(16_600 - 52);
    expect(accountBalance(after, "fees") - accountBalance(before, "fees")).toBe(52);
  });

  it("writes one entry whichever comes first: the read-back, PayPal's invoice event, or the capture's own event", async () => {
    const first = await sent();
    const capture = first.pool.payInvoice(first.invoiceId);
    const paidEvent = await handleInboxMessage(first.deps, { kind: "webhook", delivery: first.pool.invoiceEvent(first.invoiceId, "INVOICING.INVOICE.PAID") });
    expect(paidEvent).toEqual({ result: "invoice_synced", circleId: first.circle.circleId, status: "PAID", payments: ["recorded"] });
    expect(await check(first)).toEqual({ result: "invoice_synced", circleId: first.circle.circleId, status: "PAID", payments: ["already_recorded"] });
    const captureEvent = await handleInboxMessage(first.deps, { kind: "webhook", delivery: first.pool.completedEvent(capture.id) });
    expect(captureEvent).toEqual({ result: "invoice_synced", circleId: first.circle.circleId, status: "PAID", payments: ["already_recorded"] });
    expect(await invoicePayments(first.circle.circleId)).toHaveLength(1);
    expect((await paypalEventStates(db, first.circle.circleId)).map((each) => each.state)).toEqual(["processed", "processed"]);

    // A redelivered event is a duplicate.
    expect(await handleInboxMessage(first.deps, { kind: "webhook", delivery: first.pool.invoiceEvent(first.invoiceId, "INVOICING.INVOICE.PAID") })).toEqual({ result: "duplicate" });
  });

  it("ignores news that arrives out of order: a paid event before the invoice is paid records nothing, and the later read records it", async () => {
    const request = await sent();
    const early = await handleInboxMessage(request.deps, { kind: "webhook", delivery: request.pool.invoiceEvent(request.invoiceId, "INVOICING.INVOICE.PAID", "WH-early") });
    expect(early).toEqual({ result: "invoice_synced", circleId: request.circle.circleId, status: "SENT", payments: [] });
    request.pool.payInvoice(request.invoiceId);
    expect(await check(request)).toMatchObject({ payments: ["recorded"] });
    // A cancellation that arrives after the payment cannot unpay it.
    expect(await handleInboxMessage(request.deps, { kind: "webhook", delivery: request.pool.invoiceEvent(request.invoiceId, "INVOICING.INVOICE.CANCELLED") })).toMatchObject({ result: "invoice_synced", status: "PAID" });
    expect(await stateOf(request)).toBe("paid");
  });

  it("ends the request when PayPal says the invoice was cancelled", async () => {
    const request = await sent();
    await request.pool.cancelInvoice(request.invoiceId, "Withdrawn", "cancel-1");
    expect(await handleInboxMessage(request.deps, { kind: "webhook", delivery: request.pool.invoiceEvent(request.invoiceId, "INVOICING.INVOICE.CANCELLED") })).toMatchObject({ result: "invoice_synced", status: "CANCELLED" });
    expect(await stateOf(request)).toBe("cancelled");
  });

  it("credits nothing, and leaves it for a person, when the capture does not bear out PayPal's word", async () => {
    const request = await sent();
    const capture = request.pool.payInvoice(request.invoiceId);
    // The capture is still pending at PayPal.
    Object.assign(capture, { status: "PENDING" });
    expect(await check(request)).toEqual({ result: "failed", circleId: request.circle.circleId, reason: "unconfirmed" });
    expect(await invoicePayments(request.circle.circleId)).toEqual([]);
    expect(await stateOf(request)).toBe("sent");
  });

  it("refuses an invoice PayPal holds for another request, and a request Kin does not have", async () => {
    const circle = await visitorWithCircle(db);
    const pool = fakePool();
    const requestId = randomUUID();
    await asPerson(db.app, circle.userId, (tx) =>
      requestInvoice(tx, { circleId: circle.circleId, id: requestId, memberId: circle.members.marcus, purpose: "top_up", period: null, cents: 5_000, demoRecipient: "kin-member@personal.example.com" }),
    );
    // PayPal's invoice names another of Kin's requests, as a corrupted record would point at.
    const elsewhere = { circleId: circle.circleId, requestId: randomUUID() };
    const { invoiceId } = await pool.createInvoice({ number: invoiceNumberFor(elsewhere.requestId), amount: { cents: 5_000, currency: "USD" }, recipientEmail: "x@personal.example.com", reference: elsewhere, itemName: "Top-up", note: "" }, "create");
    await pool.sendInvoice(invoiceId, "send");
    await asPerson(db.app, circle.userId, (tx) => markInvoiceSent(tx, { circleId: circle.circleId, id: requestId, paypalInvoiceId: invoiceId, invoiceNumber: "KIN-X", payerUrl: null }));
    pool.payInvoice(invoiceId);
    const request: Sent = { circle, pool, deps: { db: db.service, pool }, requestId, invoiceId };
    expect(await check(request)).toEqual({ result: "failed", circleId: circle.circleId, reason: "other_circle" });
    expect(await invoicePayments(circle.circleId)).toEqual([]);
    expect(await handleInboxMessage(request.deps, { kind: "invoice_checked", circleId: circle.circleId, invoiceRequestId: randomUUID(), requestId: randomUUID() })).toEqual({
      result: "failed",
      circleId: circle.circleId,
      reason: "unknown_invoice",
    });
  });

  it("files nothing for an invoice event PayPal will not show the pool", async () => {
    const request = await sent();
    const foreign = request.pool.invoiceEvent(request.invoiceId, "INVOICING.INVOICE.PAID", "WH-foreign");
    const body = foreign.body.replace(request.invoiceId, "INV2-ZZZZ-ZZZZ-ZZZZ-ZZZZ");
    expect(await handleInboxMessage(request.deps, { kind: "webhook", delivery: { ...foreign, body } })).toEqual({ result: "unplaced" });
  });

  it("throws when PayPal cannot be reached, so the message is tried again, and records it on the retry", async () => {
    const request = await sent();
    request.pool.payInvoice(request.invoiceId);
    request.pool.failNext = "getCapture";
    await expect(check(request)).rejects.toThrow();
    expect(await invoicePayments(request.circle.circleId)).toEqual([]);
    expect(await check(request)).toMatchObject({ payments: ["recorded"] });
  });

  it("pays a demo's simulated request at once, labelled simulated, with no fee and no PayPal call", async () => {
    const circle = await visitorWithCircle(db);
    const pool = fakePool();
    const requestId = randomUUID();
    await asPerson(db.app, circle.userId, async (tx) => {
      await requestInvoice(tx, { circleId: circle.circleId, id: requestId, memberId: circle.members.marcus, purpose: "settlement", period: "2026-10", cents: 16_600, demoRecipient: null });
      await markInvoiceSent(tx, { circleId: circle.circleId, id: requestId, paypalInvoiceId: null, invoiceNumber: null, payerUrl: null });
    });
    const request: Sent = { circle, pool, deps: { db: db.service, pool }, requestId, invoiceId: "" };
    pool.failNext = "getInvoice";
    expect(await check(request)).toEqual({ result: "invoice_synced", circleId: circle.circleId, status: "paid", payments: ["recorded"] });
    expect(await invoicePayments(circle.circleId)).toMatchObject([{ simulated: true, source: { id: `simulated-invoice-${requestId}` } }]);
    expect(await check(request)).toEqual({ result: "invoice_synced", circleId: circle.circleId, status: "paid", payments: [] });
    expect(pool.requestIds).toEqual([]);
  });
});
