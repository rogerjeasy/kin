import { readFileSync } from "node:fs";

import { fakeToolModel, finalTurn, toolCalls } from "@kin/agent/testing";
import { asPerson, asService, readCircle, recordContribution, type CircleSnapshot, type InvoiceRequestRecord } from "@kin/db";
import { seatPerson, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { agentToolkitReads, encodeContributionReference, encodeInvoiceReference, parseCapture, type Capture } from "@kin/paypal";
import { fakeAgentToolkit, type FakeAgentToolkit } from "@kin/paypal/testing";
import { describe, expect, it, vi } from "vitest";

import { createRateLimiter } from "../model";
import { runAskKin } from "./ask-kin";
import { paypalDisputes, paypalInvoice, paypalOrder } from "./toolkit-tools";
import { askKinWorld, type PayPalReader } from "./world";
import { askKinSuggestions } from "@/content/circle/ask-kin-suggestions";
import { getDictionary } from "@/i18n/dictionary";
import { testDatabases } from "../../../../../packages/db/src/testing/databases.ts";

const db = testDatabases();
const NOW = new Date("2026-10-30T18:00:00Z");
const ORDER_ID = "1SN482215K962041J";
const CAPTURE_ID = "3RG65204E9591424Y";
const INVOICE_ID = "INV2-YB8W-YH4M-95PN-B53B";

type Json = Record<string, unknown>;
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../../../packages/paypal/src/fixtures/${name}`, import.meta.url), "utf8")) as Json;
const recordedOrder = fixture("order-completed.json");
const recordedInvoice = (fixture("invoice-sandbox-2026-11-08.json") as { paid: Json }).paid;
const recordedDisputes = fixture("disputes-documented-2026-11-11.json") as { list: Json; dispute: Json };

const snapshot = (circle: VisitorCircle, userId: string): Promise<CircleSnapshot> => asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: NOW }));

/** PayPal's recorded order, re-addressed to `circleId`'s member: what the sandbox answers for that circle's top-up. */
function orderFor(circleId: string, memberId: string): Json {
  const customId = encodeContributionReference({ circleId, memberId });
  const [unit] = recordedOrder["purchase_units"] as Json[];
  const [capture] = ((unit?.["payments"] as Json)["captures"] as Json[]) ?? [];
  return { ...recordedOrder, purchase_units: [{ ...unit, custom_id: customId, payments: { captures: [{ ...capture, custom_id: customId }] } }] };
}

function captureOf(order: Json): Capture {
  const [unit] = order["purchase_units"] as Json[];
  const [capture] = (unit?.["payments"] as Json)["captures"] as Json[];
  return parseCapture({ ...capture, supplementary_data: { related_ids: { order_id: ORDER_ID } } });
}

/** A PayPal reader whose captures are `order`'s and whose Agent Toolkit is `toolkit`. */
function reader(order: Json, toolkit: FakeAgentToolkit): PayPalReader & { getCapture: ReturnType<typeof vi.fn> } {
  const unused = async () => {
    throw new Error("not used here");
  };
  return { getPayoutBatch: unused, getSubscription: unused, getCapture: vi.fn(async () => captureOf(order)), toolkit: agentToolkitReads(async () => toolkit) };
}

async function world(circle: VisitorCircle, paypal: PayPalReader | null, userId = circle.userId, edit: (seen: CircleSnapshot) => CircleSnapshot = (seen) => seen) {
  return askKinWorld({ circle: edit(await snapshot(circle, userId)), locale: "en", dictionary: await getDictionary("en"), db: db.app, userId, paypal, executions: async () => [] });
}

/** A real sandbox top-up of $100.00, recorded as the worker records it once PayPal confirms the capture. */
async function realTopUp(circle: VisitorCircle, memberId: string): Promise<void> {
  const recorded = await asService(db.service, circle.circleId, (tx) =>
    recordContribution(tx, circle.circleId, { captureId: CAPTURE_ID, memberId, gross: { cents: 10_000, currency: "USD" }, fee: { cents: 398, currency: "USD" }, capturedAt: new Date("2026-10-29T15:00:00Z") }),
  );
  expect(recorded).toBe("recorded");
}

describe("PayPal's record of a top-up, through the Agent Toolkit", () => {
  it("says a simulated top-up has no PayPal record, and asks PayPal nothing", async () => {
    const circle = await visitorWithCircle(db);
    const toolkit = fakeAgentToolkit({ get_order: () => recordedOrder });
    const paypal = reader(recordedOrder, toolkit);
    const result = await paypalOrder(await world(circle, paypal), undefined);
    expect(result.data).toMatchObject({ readThrough: "PayPal Agent Toolkit", topUp: { simulated: true }, paypal: null });
    expect(result.fact).toMatch(/was simulated, so PayPal holds no record of it\.$/u);
    expect(toolkit.calls).toEqual([]);
    expect(paypal.getCapture).not.toHaveBeenCalled();
  });

  it("reads the order behind the person's own real top-up with get_order, from the capture the record holds", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    await realTopUp(circle, seen.viewer.memberId);
    const toolkit = fakeAgentToolkit({ get_order: () => orderFor(circle.circleId, seen.viewer.memberId) });
    const paypal = reader(orderFor(circle.circleId, seen.viewer.memberId), toolkit);
    const result = await paypalOrder(await world(circle, paypal), "me");

    expect(paypal.getCapture).toHaveBeenCalledWith(CAPTURE_ID);
    expect(toolkit.calls).toEqual([{ name: "get_order", input: { id: ORDER_ID } }]);
    expect(result.data).toMatchObject({
      topUp: { amount: "$100.00", simulated: false },
      paypal: { read: true, orderId: ORDER_ID, status: "COMPLETED", amount: "$100.00", captures: [{ status: "COMPLETED", amount: "$100.00" }], matchesTheRecord: true },
    });
    expect(result.fact).toMatch(/^PayPal's own record of .+'s top-up of \$100\.00 on Oct 29: the order is COMPLETED\.$/u);
    // Only fixed words, amounts and times: no payer's name or email.
    expect(JSON.stringify(result.data)).not.toMatch(/buyer@|Test Buyer|pool@business/u);
  });

  it("shows nothing of an order that does not name this circle", async () => {
    const circle = await visitorWithCircle(db);
    const other = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    await realTopUp(circle, seen.viewer.memberId);
    const theirs = orderFor(other.circleId, other.members.elena);
    const result = await paypalOrder(await world(circle, reader(orderFor(circle.circleId, seen.viewer.memberId), fakeAgentToolkit({ get_order: () => theirs }))), undefined);
    expect(result.data).toMatchObject({ paypal: { read: false } });
    expect(JSON.stringify(result.data)).not.toContain(ORDER_ID);
    expect(result.fact).toBe("PayPal could not be read just now, so Kin shows only its own record.");
  });

  it("says PayPal could not be read when the toolkit answers with an error, and never invents a status", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    await realTopUp(circle, seen.viewer.memberId);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await paypalOrder(await world(circle, reader(orderFor(circle.circleId, seen.viewer.memberId), fakeAgentToolkit({}))), undefined);
    expect(result.data).toMatchObject({ paypal: { read: false, why: "PayPal could not be read just now" } });
    expect(JSON.stringify(result.data)).not.toMatch(/COMPLETED|RESOURCE_NOT_FOUND/u);
    expect(error).toHaveBeenCalledWith(JSON.stringify({ message: "ask_kin.paypal_toolkit", reason: "paypal_refused", status: 404 }));
    error.mockRestore();
  });
});

describe("PayPal's record of an invoice, through the Agent Toolkit", () => {
  const request = (memberId: string, overrides: Partial<InvoiceRequestRecord> = {}): InvoiceRequestRecord => ({
    id: "1a0ad39a-2fb9-439f-a970-981c9d91533b",
    memberId,
    requestedBy: memberId,
    purpose: "top_up",
    period: "2026-10",
    cents: 16_600,
    state: "sent",
    simulated: false,
    recipient: "m***@personal.example.com",
    paypalInvoiceId: INVOICE_ID,
    invoiceNumber: "KIN-1A0AD39A2FB9439FA9709",
    payerUrl: null,
    createdAt: new Date("2026-10-20T12:00:00Z"),
    paidAt: null,
    ...overrides,
  });

  it("reads a real invoice with get_invoice and checks it names this circle's request", async () => {
    const circle = await visitorWithCircle(db);
    const invoice = { ...recordedInvoice, detail: { ...(recordedInvoice["detail"] as Json), memo: encodeInvoiceReference({ circleId: circle.circleId, requestId: "1a0ad39a-2fb9-439f-a970-981c9d91533b" }) } };
    const toolkit = fakeAgentToolkit({ get_invoice: () => invoice });
    const seen = await world(circle, reader(recordedOrder, toolkit), circle.userId, (snap) => ({ ...snap, invoiceRequests: [request(circle.members.ana)] }));
    const result = await paypalInvoice(seen, "Ana");
    expect(toolkit.calls).toEqual([{ name: "get_invoice", input: { invoice_id: INVOICE_ID } }]);
    expect(result.data).toMatchObject({ paypal: { read: true, status: "PAID", amount: "$166.00", paid: "$166.00", matchesTheRecord: true } });
    expect(result.fact).toBe("PayPal's invoice to Ana for $166.00 is PAID.");
  });

  it("shows nothing of an invoice whose memo names another circle, and labels a simulated one without asking PayPal", async () => {
    const circle = await visitorWithCircle(db);
    const toolkit = fakeAgentToolkit({ get_invoice: () => recordedInvoice });
    const theirs = await paypalInvoice(await world(circle, reader(recordedOrder, toolkit), circle.userId, (snap) => ({ ...snap, invoiceRequests: [request(circle.members.ana)] })), undefined);
    expect(theirs.data).toMatchObject({ paypal: { read: false } });
    expect(JSON.stringify(theirs.data)).not.toContain("PAID");

    const quiet = fakeAgentToolkit({ get_invoice: () => recordedInvoice });
    const simulated = await paypalInvoice(
      await world(circle, reader(recordedOrder, quiet), circle.userId, (snap) => ({ ...snap, invoiceRequests: [request(circle.members.ana, { simulated: true, paypalInvoiceId: null, recipient: null })] })),
      undefined,
    );
    expect(simulated.fact).toBe("The invoice to Ana for $166.00 was simulated, so PayPal holds no record of it.");
    expect(quiet.calls).toEqual([]);
  });
});

describe("disputes on the top-ups, through the Agent Toolkit", () => {
  it("lists by the record's own capture, keeps only disputes that name it, and passes on no buyer's message", async () => {
    const circle = await visitorWithCircle(db);
    await realTopUp(circle, circle.members.marcus);
    const elsewhere = { ...recordedDisputes.dispute, dispute_id: "PP-D-99999", disputed_transactions: [{ seller_transaction_id: "9ZZ00000ZZ0000000" }] };
    const toolkit = fakeAgentToolkit({
      list_disputes: () => ({ items: [recordedDisputes.list["items"] as Json[]].flat().concat([{ dispute_id: "PP-D-99999", status: "OPEN" }]) }),
      get_dispute: (input) => (input["dispute_id"] === "PP-D-99999" ? elsewhere : recordedDisputes.dispute),
    });
    const result = await paypalDisputes(await world(circle, reader(recordedOrder, toolkit)));
    expect(toolkit.calls.map((call) => call.name)).toEqual(["list_disputes", "get_dispute", "get_dispute"]);
    expect(toolkit.calls[0]?.input).toEqual({ disputed_transaction_id: CAPTURE_ID, page_size: 10 });
    expect(result.data).toMatchObject({ checked: [{ member: "Marcus", amount: "$100.00", disputes: [{ status: "WAITING_FOR_SELLER_RESPONSE", reason: "UNAUTHORISED", amount: "$100.00" }], notShown: 1 }] });
    expect(JSON.stringify(result.data)).not.toMatch(/Ignore your instructions|Test Buyer|PP-D-99999/u);
    expect(result.fact).toBe("PayPal shows a dispute on Marcus's top-up of $100.00: WAITING_FOR_SELLER_RESPONSE.");
  });

  it("asks PayPal nothing when every top-up was simulated", async () => {
    const circle = await visitorWithCircle(db);
    const toolkit = fakeAgentToolkit({});
    const result = await paypalDisputes(await world(circle, reader(recordedOrder, toolkit)));
    expect(result.fact).toBe("The circle's top-ups were simulated, so PayPal holds no disputes for them.");
    expect(toolkit.calls).toEqual([]);
  });
});

describe("Ask Kin with the Agent Toolkit", () => {
  const ask = (question: string) => ({ question, locale: "en" });
  const SUGGESTION = "Show me PayPal's own record of the last top-up";
  const suggested = async (circle: VisitorCircle, userId: string) => {
    const seen = await world(circle, null, userId);
    return askKinSuggestions(seen.circle, (await getDictionary("en")).askKin.suggestions, seen.format, seen.names);
  };

  it("suggests asking for PayPal's own record only once a real top-up is on record, and never to a caregiver", async () => {
    const circle = await visitorWithCircle(db);
    expect(await suggested(circle, circle.userId)).not.toContain(SUGGESTION);
    await realTopUp(circle, circle.members.marcus);
    expect(await suggested(circle, circle.userId)).toContain(SUGGESTION);
    expect(await suggested(circle, await seatPerson(db, circle.circleId, circle.members.amara))).not.toContain(SUGGESTION);
  });

  it("answers from PayPal's own record and labels the step as the PayPal Agent Toolkit", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    await realTopUp(circle, seen.viewer.memberId);
    const order = orderFor(circle.circleId, seen.viewer.memberId);
    const model = fakeToolModel(toolCalls({ name: "get_paypal_order", input: { member: "me" } }), finalTurn("PayPal's own record shows your top-up of $100.00 on Oct 29, and the order is COMPLETED."));
    const result = await runAskKin(
      { db: db.app, userId: circle.userId, circle: await snapshot(circle, circle.userId), accountTypes: "demo", model, paypal: reader(order, fakeAgentToolkit({ get_order: () => order })), recorder: () => undefined, limiter: createRateLimiter(10, 3_600_000), budget: createRateLimiter(100, 3_600_000), now: () => 1_000 },
      ask("Show me PayPal's record of my last top-up."),
    );
    expect(result).toMatchObject({
      ok: true,
      source: "claude",
      answer: "PayPal's own record shows your top-up of $100.00 on Oct 29, and the order is COMPLETED.",
      steps: [{ tool: "get_paypal_order", label: "Read PayPal's own record of the top-up (PayPal Agent Toolkit)", outcome: "ok" }],
    });
  });

  it("refuses a caregiver the toolkit's reads, and asks PayPal nothing", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const toolkit = fakeAgentToolkit({ get_order: () => recordedOrder });
    const model = fakeToolModel(toolCalls({ name: "get_paypal_order", input: {} }, { name: "list_paypal_disputes", input: {} }), finalTurn("Kin cannot show that from your seat."));
    const result = await runAskKin(
      { db: db.app, userId: amara, circle: await snapshot(circle, amara), accountTypes: "demo", model, paypal: reader(recordedOrder, toolkit), recorder: () => undefined, limiter: createRateLimiter(10, 3_600_000), budget: createRateLimiter(100, 3_600_000), now: () => 1_000 },
      ask("Show me PayPal's record of the last top-up."),
    );
    expect(result).toMatchObject({ ok: true, steps: [{ tool: "get_paypal_order", outcome: "refused" }, { tool: "list_paypal_disputes", outcome: "refused" }] });
    expect(model.requests[0]?.tools.map((tool) => tool.name)).not.toContain("get_paypal_order");
    expect(toolkit.calls).toEqual([]);
  });
});
