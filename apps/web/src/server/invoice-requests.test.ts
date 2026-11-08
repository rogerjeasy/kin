import { asPerson, takeDemoSeat, type CircleSnapshot } from "@kin/db";
import { snapshotFor, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import type { Inbox, InboxMessage } from "@kin/paypal";
import { fakePool, type FakePool } from "@kin/paypal/testing";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { periodSettlement } from "@/content/circle/fairness";
import { openPeriod } from "@/content/circle/period";

import { runInvoiceRequest, type InvoiceContext } from "./invoice-requests";

const db = testDatabases();
const SANDBOX_MEMBER = "kin-member@personal.example.com";

function fakeInbox(): Inbox & { sent: InboxMessage[] } {
  const sent: InboxMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
    receive: async () => [],
    remove: async () => undefined,
  };
}

type Setup = { context: InvoiceContext; pool: FakePool; inbox: ReturnType<typeof fakeInbox>; visitor: VisitorCircle; reload: () => Promise<CircleSnapshot> };

/** A demo visitor in `persona`'s seat of a fresh demo circle; Elena, the organizer, unless another is named. */
async function demoAs(persona: keyof VisitorCircle["members"] = "elena", options: { recipient?: string | null; services?: boolean } = {}): Promise<Setup> {
  const visitor = await visitorWithCircle(db);
  if (persona !== "elena") await asPerson(db.app, visitor.userId, (tx) => takeDemoSeat(tx, visitor.circleId, visitor.members[persona]));
  const pool = fakePool();
  const inbox = fakeInbox();
  const context: InvoiceContext = {
    db: db.app,
    userId: visitor.userId,
    circle: await snapshotFor(db, visitor.userId, visitor.circleId),
    services: options.services === false ? null : { pool, inbox },
    demoRecipient: options.recipient === undefined ? SANDBOX_MEMBER : options.recipient,
    words: { item: (purpose) => (purpose === "settlement" ? "Rose's circle: your share" : "Rose's circle: a top-up"), note: "Requested through Kin.", cancelNote: "Withdrawn." },
  };
  return { context, pool, inbox, visitor, reload: () => snapshotFor(db, visitor.userId, visitor.circleId) };
}

/** What the money core's plan collects from a member this month, or 0. */
const owedBy = (circle: CircleSnapshot, memberId: string) => periodSettlement(circle, openPeriod(circle))?.plan.collections.find((each) => each.memberId === memberId)?.cents ?? 0;
const settlement = (memberId: string, id: string = randomUUID()) => ({ operation: "request", id, memberId, purpose: "settlement" });
const refresh = async (setup: Setup) => ({ ...setup.context, circle: await setup.reload() });

describe("asking a member for the settlement by PayPal invoice", () => {
  it("makes, sends and reads back a PayPal invoice for exactly what the money core collects, and records it sent", async () => {
    const setup = await demoAs();
    const marcus = setup.visitor.members.marcus;
    const owed = owedBy(setup.context.circle, marcus);
    expect(owed).toBeGreaterThan(0);

    const answer = await runInvoiceRequest(setup.context, settlement(marcus));
    expect(answer).toMatchObject({ ok: true });

    const [invoice] = [...setup.pool.invoices.values()];
    expect(invoice).toMatchObject({ status: "SENT", request: { amount: { cents: owed, currency: "USD" }, recipientEmail: SANDBOX_MEMBER, reference: { circleId: setup.visitor.circleId } } });
    const [request] = (await setup.reload()).invoiceRequests;
    expect(request).toMatchObject({ memberId: marcus, purpose: "settlement", cents: owed, state: "sent", simulated: false, paypalInvoiceId: invoice?.id, invoiceNumber: invoice?.number, recipient: "k••••@personal.example.com" });
    expect(setup.inbox.sent).toEqual([{ kind: "invoice_checked", circleId: setup.visitor.circleId, invoiceRequestId: request?.id, requestId: expect.any(String) }]);
  });

  it("never sends a second invoice: the same request again, or a second while one waits", async () => {
    const setup = await demoAs();
    const marcus = setup.visitor.members.marcus;
    const id = randomUUID();
    await runInvoiceRequest(setup.context, settlement(marcus, id));
    const context = await refresh(setup);
    expect(await runInvoiceRequest(context, settlement(marcus, id))).toEqual({ ok: true, id });
    expect(await runInvoiceRequest(context, settlement(marcus))).toEqual({ ok: false, reason: "open" });
    expect(setup.pool.invoices.size).toBe(1);
  });

  it("resumes a request whose answer from PayPal was lost, finding the draft PayPal made by its number", async () => {
    const setup = await demoAs();
    const marcus = setup.visitor.members.marcus;
    setup.pool.loseNextReply = "createInvoice";
    expect(await runInvoiceRequest(setup.context, settlement(marcus))).toEqual({ ok: false, reason: "paypal" });
    expect((await setup.reload()).invoiceRequests).toMatchObject([{ state: "requested" }]);

    // The organizer presses again: a new key from the browser, the same request on the server.
    const answer = await runInvoiceRequest(await refresh(setup), settlement(marcus));
    expect(answer).toMatchObject({ ok: true });
    expect(setup.pool.invoices.size).toBe(1);
    expect((await setup.reload()).invoiceRequests).toMatchObject([{ state: "sent" }]);
  });

  it("records the invoice sent when PayPal sent it but its answer was lost, from the invoice read back", async () => {
    const setup = await demoAs();
    setup.pool.loseNextReply = "sendInvoice";
    expect(await runInvoiceRequest(setup.context, settlement(setup.visitor.members.marcus))).toMatchObject({ ok: true });
    expect((await setup.reload()).invoiceRequests).toMatchObject([{ state: "sent" }]);
  });

  it("ends the request as failed when PayPal refuses the invoice, and lets the organizer ask again", async () => {
    const setup = await demoAs();
    const marcus = setup.visitor.members.marcus;
    setup.pool.refuseNextInvoice = "INVALID_EMAIL_ADDRESS";
    expect(await runInvoiceRequest(setup.context, settlement(marcus))).toEqual({ ok: false, reason: "paypal" });
    expect((await setup.reload()).invoiceRequests).toMatchObject([{ state: "failed" }]);
    expect(await runInvoiceRequest(await refresh(setup), settlement(marcus))).toMatchObject({ ok: true });
  });

  it("simulates the invoice in a demo with no sandbox account to stand in, labelled so, and asks the worker to record it", async () => {
    const setup = await demoAs("elena", { recipient: null });
    const marcus = setup.visitor.members.marcus;
    expect(await runInvoiceRequest(setup.context, settlement(marcus))).toMatchObject({ ok: true });
    expect(setup.pool.invoices.size).toBe(0);
    const [request] = (await setup.reload()).invoiceRequests;
    expect(request).toMatchObject({ state: "sent", simulated: true, paypalInvoiceId: null, recipient: null });
    expect(setup.inbox.sent).toMatchObject([{ kind: "invoice_checked", invoiceRequestId: request?.id }]);
  });

  it("takes no amount from the browser, and asks nothing of a member the plan collects nothing from", async () => {
    const setup = await demoAs();
    const { marcus, ana } = setup.visitor.members;
    expect(await runInvoiceRequest(setup.context, { ...settlement(marcus), amount: "1.00" })).toEqual({ ok: false, reason: "invalid" });
    expect(owedBy(setup.context.circle, ana)).toBe(0);
    expect(await runInvoiceRequest(setup.context, settlement(ana))).toEqual({ ok: false, reason: "not_owed" });
    for (const bad of [null, [], { operation: "request" }, { ...settlement(marcus), id: "1" }, { ...settlement(marcus), purpose: "gift" }, { operation: "delete", id: randomUUID() }]) {
      expect(await runInvoiceRequest(setup.context, bad)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(setup.pool.invoices.size).toBe(0);
  });

  it("is off where this deployment has no PayPal", async () => {
    const setup = await demoAs("elena", { services: false });
    expect(await runInvoiceRequest(setup.context, settlement(setup.visitor.members.marcus))).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("who may ask, withdraw and check", () => {
  it("refuses every role but an organizer, least privileged first, and sends nothing to PayPal", async () => {
    for (const persona of ["daniel", "amara", "rose", "marcus"] as const) {
      const setup = await demoAs(persona);
      const answer = await runInvoiceRequest(setup.context, settlement(setup.visitor.members.ana));
      expect({ persona, answer }).toEqual({ persona, answer: { ok: false, reason: "refused" } });
      expect(setup.pool.invoices.size).toBe(0);
    }
  });

  it("lets the member asked check their own invoice with PayPal, but not withdraw it; another member may do neither", async () => {
    const organizer = await demoAs();
    const marcus = organizer.visitor.members.marcus;
    await runInvoiceRequest(organizer.context, settlement(marcus));
    const [request] = (await organizer.reload()).invoiceRequests;
    if (request === undefined) throw new Error("No request");

    // Marcus sits in his own seat now.
    await asPerson(db.app, organizer.visitor.userId, (tx) => takeDemoSeat(tx, organizer.visitor.circleId, marcus));
    const asMarcus = await refresh(organizer);
    expect(await runInvoiceRequest(asMarcus, { operation: "check", id: request.id })).toEqual({ ok: true, id: request.id });
    expect(await runInvoiceRequest(asMarcus, { operation: "cancel", id: request.id })).toEqual({ ok: false, reason: "refused" });

    await asPerson(db.app, organizer.visitor.userId, (tx) => takeDemoSeat(tx, organizer.visitor.circleId, organizer.visitor.members.ana));
    const asAna = await refresh(organizer);
    expect(await runInvoiceRequest(asAna, { operation: "check", id: request.id })).toEqual({ ok: false, reason: "refused" });
  });

  it("withdraws a sent invoice at PayPal first, and refuses to withdraw one already paid", async () => {
    const setup = await demoAs();
    const marcus = setup.visitor.members.marcus;
    await runInvoiceRequest(setup.context, settlement(marcus));
    const [first] = (await setup.reload()).invoiceRequests;
    if (first?.paypalInvoiceId == null) throw new Error("Not sent");
    expect(await runInvoiceRequest(await refresh(setup), { operation: "cancel", id: first.id })).toEqual({ ok: true, id: first.id });
    expect(setup.pool.invoices.get(first.paypalInvoiceId)?.status).toBe("CANCELLED");
    expect((await setup.reload()).invoiceRequests).toMatchObject([{ id: first.id, state: "cancelled" }]);

    await runInvoiceRequest(await refresh(setup), settlement(marcus));
    const [second] = (await setup.reload()).invoiceRequests;
    if (second?.paypalInvoiceId == null) throw new Error("Not sent");
    setup.pool.payInvoice(second.paypalInvoiceId);
    expect(await runInvoiceRequest(await refresh(setup), { operation: "cancel", id: second.id })).toEqual({ ok: false, reason: "paid" });
    expect(setup.pool.invoices.get(second.paypalInvoiceId)?.status).toBe("PAID");
  });
});

describe("asking a member for a top-up by PayPal invoice", () => {
  it("reads the typed amount digit by digit and holds it to a top-up's limits", async () => {
    const setup = await demoAs();
    const ana = setup.visitor.members.ana;
    const topUp = (amount: string) => ({ operation: "request", id: randomUUID(), memberId: ana, purpose: "top_up", amount });
    expect(await runInvoiceRequest(setup.context, topUp("0.50"))).toEqual({ ok: false, reason: "too_small" });
    expect(await runInvoiceRequest(setup.context, topUp("1e3"))).toEqual({ ok: false, reason: "invalid" });
    expect(await runInvoiceRequest(setup.context, topUp(" 50,00 "))).toMatchObject({ ok: true });
    expect([...setup.pool.invoices.values()].map((invoice) => invoice.request.amount)).toEqual([{ cents: 5_000, currency: "USD" }]);
  });
});
