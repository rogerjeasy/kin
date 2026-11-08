import { accountBalance, memberAccount } from "@kin/domain";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  InvoiceRequestError,
  closeInvoiceRequest,
  followInvoiceCancelled,
  markInvoiceSent,
  readInvoiceRequest,
  recordInvoicePayment,
  recordSimulatedInvoicePayment,
  requestInvoice,
  type NewInvoiceRequest,
} from "./invoice-requests.ts";
import { readLedger } from "./ledger-store.ts";
import { createCircle, membershipsOf } from "./people.ts";
import { readCircle } from "./read-circle.ts";
import { invoiceRequests } from "./schema/index.ts";
import { asPerson, asService } from "./scope.ts";
import { setOwnSettlementReceiver } from "./settlement-proposals.ts";
import { addMember, seatPerson, signedIn, visitorWithCircle, type VisitorCircle } from "./testing/circles.ts";
import { testDatabases } from "./testing/databases.ts";
import { errorCode } from "./testing/sql.ts";

const db = testDatabases();
const KIN_SANDBOX_MEMBER = "kin-member@personal.example.com";
/** PayPal's invoice IDs are unique everywhere, so each test draws its own. */
const invoiceId = () => `INV2-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase().match(/.{4}/g)?.join("-") ?? ""}`;

const settlementOf = (circle: VisitorCircle, overrides: Partial<NewInvoiceRequest> = {}): NewInvoiceRequest => ({
  circleId: circle.circleId,
  id: randomUUID(),
  memberId: circle.members.marcus,
  purpose: "settlement",
  period: "2026-10",
  cents: 16_600,
  demoRecipient: KIN_SANDBOX_MEMBER,
  ...overrides,
});

const ask = (userId: string, input: NewInvoiceRequest) => asPerson(db.app, userId, (tx) => requestInvoice(tx, input));
const refusal = async (work: Promise<unknown>) => {
  try {
    await work;
    return "no error";
  } catch (error) {
    return error instanceof InvoiceRequestError ? error.reason : String(error);
  }
};
const serviceRead = (circleId: string, id: string) => asService(db.service, circleId, (tx) => readInvoiceRequest(tx, circleId, { id }));
const ledgerOf = (circleId: string) => asService(db.service, circleId, (tx) => readLedger(tx, { id: circleId, currency: "USD" }));

describe("an organizer's request for money by PayPal invoice", () => {
  it("goes to Kin's own sandbox account in a demo circle, and the same request again returns the same row", async () => {
    const circle = await visitorWithCircle(db);
    const input = settlementOf(circle);
    const made = await ask(circle.userId, input);
    expect(made).toEqual({
      request: { id: input.id, memberId: circle.members.marcus, purpose: "settlement", period: "2026-10", amount: { cents: 16_600, currency: "USD" }, state: "requested", simulated: false, paypalInvoiceId: null },
      recipient: KIN_SANDBOX_MEMBER,
    });
    expect(await ask(circle.userId, input)).toEqual(made);
    // A second request while the first waits is refused; the key reused for another request is invalid.
    expect(await refusal(ask(circle.userId, settlementOf(circle)))).toBe("open");
    expect(await refusal(ask(circle.userId, { ...input, cents: 100 }))).toBe("invalid");
  });

  it("is simulated in a demo circle with no sandbox account to stand in, and says so", async () => {
    const circle = await visitorWithCircle(db);
    const made = await ask(circle.userId, settlementOf(circle, { demoRecipient: null }));
    expect(made.recipient).toBeNull();
    expect(made.request.simulated).toBe(true);
  });

  it("is refused to every role but an organizer, least privileged first", async () => {
    const circle = await visitorWithCircle(db);
    for (const member of ["amara", "daniel", "rose", "ana"] as const) {
      const userId = await seatPerson(db, circle.circleId, circle.members[member]);
      expect({ member, reason: await refusal(ask(userId, settlementOf(circle, { memberId: circle.members.marcus }))) }).toEqual({ member, reason: "refused" });
    }
    const rows = await db.admin.execute<{ count: string }>(sql`select count(*) from invoice_requests where circle_id = ${circle.circleId}`);
    expect(Number(rows.rows[0]?.count)).toBe(0);
  });

  it("asks only a member who shares the cost, and never the organizer themselves", async () => {
    const circle = await visitorWithCircle(db);
    for (const member of ["rose", "amara", "daniel", "elena"] as const) {
      expect({ member, reason: await refusal(ask(circle.userId, settlementOf(circle, { memberId: circle.members[member] }))) }).toEqual({ member, reason: "refused" });
    }
  });

  it("holds a top-up request to a top-up's limits, and a settlement request to its period", async () => {
    const circle = await visitorWithCircle(db);
    const topUp = { purpose: "top_up" as const, period: null };
    expect(await refusal(ask(circle.userId, settlementOf(circle, { ...topUp, cents: 99 })))).toBe("invalid");
    expect(await refusal(ask(circle.userId, settlementOf(circle, { ...topUp, cents: 500_001 })))).toBe("invalid");
    expect(await refusal(ask(circle.userId, settlementOf(circle, { period: null })))).toBe("invalid");
    expect(await refusal(ask(circle.userId, settlementOf(circle, { ...topUp, period: "2026-10" })))).toBe("invalid");
    expect((await ask(circle.userId, settlementOf(circle, { ...topUp, cents: 5_000 }))).request.purpose).toBe("top_up");
  });
});

describe("a real family's request", () => {
  async function family() {
    const organizer = await signedIn(db.app, "Priya Shah");
    const circleId = await asPerson(db.app, organizer, (tx) => createCircle(tx, { name: "Mum's circle", timezone: "UTC", currency: "USD", parentName: "Meera", parentLevel: "decides", relationship: null }));
    const brotherEmail = `ravi-${randomUUID()}@example.com`;
    const brother = await signedIn(db.app, "Ravi Shah", brotherEmail);
    const brotherSeat = randomUUID();
    await db.admin.execute(sql`insert into members (id, circle_id, user_id, display_name, role) values (${brotherSeat}, ${circleId}, ${brother}, 'Ravi', 'contributor')`);
    return { organizer, circleId, brother, brotherSeat, brotherEmail };
  }
  const topUp = (circleId: string, memberId: string, demoRecipient: string | null = null): NewInvoiceRequest => ({ circleId, id: randomUUID(), memberId, purpose: "top_up", period: null, cents: 5_000, demoRecipient });

  it("goes to the email the member verified, or the PayPal email they gave for their payouts, never to one the request names", async () => {
    const { organizer, circleId, brother, brotherSeat, brotherEmail } = await family();
    expect(await refusal(ask(organizer, topUp(circleId, brotherSeat, "attacker@example.com")))).toBe("refused");
    const first = await ask(organizer, topUp(circleId, brotherSeat));
    expect(first).toMatchObject({ recipient: brotherEmail.toLowerCase(), request: { simulated: false } });
    await asPerson(db.app, organizer, (tx) => closeInvoiceRequest(tx, { circleId, id: first.request.id, state: "failed" }));

    await asPerson(db.app, brother, (tx) => setOwnSettlementReceiver(tx, { circleId, email: "ravi.paypal@example.com" }));
    expect((await ask(organizer, topUp(circleId, brotherSeat))).recipient).toBe("ravi.paypal@example.com");
  });

  it("is refused when the member has no email Kin may use", async () => {
    const { organizer, circleId } = await family();
    const silent = randomUUID();
    await db.admin.execute(sql`insert into members (id, circle_id, display_name, role) values (${silent}, ${circleId}, 'Uncle', 'contributor')`);
    expect(await refusal(ask(organizer, topUp(circleId, silent)))).toBe("no_email");
    const [seat] = await asPerson(db.app, organizer, (tx) => membershipsOf(tx, organizer));
    expect(seat?.role).toBe("organizer");
  });
});

describe("what PayPal did with the invoice", () => {
  async function sent(circle: VisitorCircle) {
    const { request } = await ask(circle.userId, settlementOf(circle));
    await asPerson(db.app, circle.userId, (tx) =>
      markInvoiceSent(tx, { circleId: circle.circleId, id: request.id, paypalInvoiceId: invoiceId(), invoiceNumber: "KIN-1A0AD39A2FB9439FA9709", payerUrl: "https://www.sandbox.paypal.com/invoice/p/#YB8WYH4M95PNB53B" }),
    );
    const row = await serviceRead(circle.circleId, request.id);
    if (row === null) throw new Error("No request");
    return row;
  }

  it("is recorded as sent only with a PayPal invoice ID, and never with another's address", async () => {
    const circle = await visitorWithCircle(db);
    const { request } = await ask(circle.userId, settlementOf(circle));
    const id = invoiceId();
    const mark = (paypalInvoiceId: string | null, payerUrl: string | null) =>
      refusal(asPerson(db.app, circle.userId, (tx) => markInvoiceSent(tx, { circleId: circle.circleId, id: request.id, paypalInvoiceId, invoiceNumber: "KIN-1", payerUrl })));
    expect(await mark(null, null)).toBe("invalid");
    expect(await mark("INV2-../x", null)).toBe("invalid");
    expect(await mark(id, "https://evil.example/pay")).toBe("invalid");
    expect(await mark(id, "https://www.sandbox.paypal.com/invoice/p/#AAAA")).toBe("no error");
    expect(await mark(id, "https://www.sandbox.paypal.com/invoice/p/#AAAA")).toBe("no error");
    const marcus = await seatPerson(db, circle.circleId, circle.members.marcus);
    expect(await refusal(asPerson(db.app, marcus, (tx) => markInvoiceSent(tx, { circleId: circle.circleId, id: request.id, paypalInvoiceId: invoiceId(), invoiceNumber: "X", payerUrl: null })))).toBe("refused");
  });

  it("credits the member once when paid, like a top-up, and the request ends paid", async () => {
    const circle = await visitorWithCircle(db);
    const request = await sent(circle);
    const before = await ledgerOf(circle.circleId);
    const payment = { paymentId: "7YJ40056GS034901G", gross: { cents: 16_600, currency: "USD" }, fee: { cents: 628, currency: "USD" }, paidAt: new Date("2026-11-08T08:59:17Z"), simulated: false };
    expect(await asService(db.service, circle.circleId, (tx) => recordInvoicePayment(tx, circle.circleId, request, payment))).toBe("recorded");
    const paid = await serviceRead(circle.circleId, request.id);
    expect(paid?.state).toBe("paid");
    if (paid === null) throw new Error("No request");
    expect(await asService(db.service, circle.circleId, (tx) => recordInvoicePayment(tx, circle.circleId, paid, payment))).toBe("already_recorded");

    const after = await ledgerOf(circle.circleId);
    const marcus = memberAccount(circle.members.marcus);
    expect(accountBalance(after, marcus) - accountBalance(before, marcus)).toBe(16_600);
    expect(accountBalance(after, "pool_cash") - accountBalance(before, "pool_cash")).toBe(16_600 - 628);
    expect(accountBalance(after, "fees") - accountBalance(before, "fees")).toBe(628);
    const entry = after.entries.find((each) => each.source.id === "7YJ40056GS034901G");
    expect(entry).toMatchObject({ kind: "contribution", simulated: false, description: "Paid a PayPal invoice" });
  });

  it("records a demo's simulated invoice as paid at once, labelled simulated, with no fee, and only in a demo circle", async () => {
    const circle = await visitorWithCircle(db);
    const { request } = await ask(circle.userId, settlementOf(circle, { demoRecipient: null }));
    await asPerson(db.app, circle.userId, (tx) => markInvoiceSent(tx, { circleId: circle.circleId, id: request.id, paypalInvoiceId: null, invoiceNumber: null, payerUrl: null }));
    const row = await serviceRead(circle.circleId, request.id);
    if (row === null) throw new Error("No request");
    expect(await asService(db.service, circle.circleId, (tx) => recordSimulatedInvoicePayment(tx, circle.circleId, row))).toBe("recorded");
    const entry = (await ledgerOf(circle.circleId)).entries.find((each) => each.source.id === `simulated-invoice-${request.id}`);
    expect(entry).toMatchObject({ simulated: true, description: "Paid an invoice (simulated)" });
    const real = await sent(await visitorWithCircle(db));
    await expect(asService(db.service, circle.circleId, (tx) => recordSimulatedInvoicePayment(tx, circle.circleId, real))).rejects.toThrow(InvoiceRequestError);
  });

  it("only ever moves forward, and what it asks of whom never changes, whoever writes", async () => {
    const circle = await visitorWithCircle(db);
    const request = await sent(circle);
    const update = (values: Partial<typeof invoiceRequests.$inferInsert>) =>
      errorCode(asService(db.service, circle.circleId, (tx) => tx.update(invoiceRequests).set(values).where(eq(invoiceRequests.id, request.id))));
    expect(await update({ amountCents: 1 })).toBe("KB015");
    expect(await update({ state: "requested" })).toBe("KB015");
    await asService(db.service, circle.circleId, (tx) => followInvoiceCancelled(tx, circle.circleId, request));
    expect((await serviceRead(circle.circleId, request.id))?.state).toBe("cancelled");
    expect(await update({ state: "sent" })).toBe("KB015");
    // Withdrawn already: the organizer cannot reopen it, and cancelling again changes nothing.
    await asPerson(db.app, circle.userId, (tx) => closeInvoiceRequest(tx, { circleId: circle.circleId, id: request.id, state: "cancelled" }));
    expect(await refusal(asPerson(db.app, circle.userId, (tx) => closeInvoiceRequest(tx, { circleId: circle.circleId, id: request.id, state: "failed" })))).toBe("move");
  });
});

describe("who reads invoice requests (AGENTS.md section 6)", () => {
  it("everyone who sees the money reads them; a caregiver reads none; only the payer and organizers get PayPal's page", async () => {
    const circle = await visitorWithCircle(db);
    const { request } = await ask(circle.userId, settlementOf(circle));
    await asPerson(db.app, circle.userId, (tx) =>
      markInvoiceSent(tx, { circleId: circle.circleId, id: request.id, paypalInvoiceId: invoiceId(), invoiceNumber: "KIN-1", payerUrl: "https://www.sandbox.paypal.com/invoice/p/#AAAA" }),
    );
    const read = async (userId: string) => (await asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: new Date() }))).invoiceRequests;
    const organizer = await read(circle.userId);
    expect(organizer).toMatchObject([{ id: request.id, state: "sent", recipient: "k••••@personal.example.com", payerUrl: "https://www.sandbox.paypal.com/invoice/p/#AAAA" }]);
    const marcus = await read(await seatPerson(db, circle.circleId, circle.members.marcus));
    expect(marcus[0]?.payerUrl).toBe("https://www.sandbox.paypal.com/invoice/p/#AAAA");
    const ana = await read(await seatPerson(db, circle.circleId, circle.members.ana));
    expect(ana).toMatchObject([{ id: request.id, payerUrl: null }]);
    const observer = await addMember(db, circle.circleId, "observer");
    expect(await read(observer.userId)).toHaveLength(1);
    expect(await read(await seatPerson(db, circle.circleId, circle.members.amara))).toEqual([]);
  });
});
