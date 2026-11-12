import { createHash, randomBytes } from "node:crypto";

import { checkBillReview, parseAgencyInvoice, parseVisitReport } from "@kin/domain";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { agencyInvoiceStatus, readAgencyInvoices, receiveAgencyInvoice } from "./agency-invoices.ts";
import { declineAgencyInvoice, reviewBill } from "./bill-payments.ts";
import type { Transaction } from "./connection.ts";
import { OpenKinError, createAgencyKey, receiveAgencyVisit } from "./open-kin.ts";
import { answerProposal } from "./operations.ts";
import { takeDemoSeat } from "./people.ts";
import { bills, executions, payees, proposals } from "./schema/index.ts";
import { asPerson, asService } from "./scope.ts";
import { seatPerson, visitorWithCircle, type VisitorCircle } from "./testing/circles.ts";
import { testDatabases } from "./testing/databases.ts";
import { errorCode } from "./testing/sql.ts";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");
const EMAIL = "billing@sunrise.example";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

type Persona = keyof VisitorCircle["members"];
const asPersona = <T>(circle: VisitorCircle, persona: Persona, work: (tx: Transaction) => Promise<T>) =>
  asPerson(db.app, circle.userId, async (tx) => {
    await takeDemoSeat(tx, circle.circleId, circle.members[persona]);
    return work(tx);
  });
const service = <T>(circle: VisitorCircle, work: (tx: Transaction) => Promise<T>) => asService(db.service, circle.circleId, work);
const reason = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
    return "no error";
  } catch (error) {
    return error instanceof OpenKinError || (error instanceof Error && "reason" in error) ? String((error as { reason: unknown }).reason) : `uncoded: ${String(error)}`;
  }
};

type Key = { readonly keyId: string; readonly secret: string };

async function agency(circle: VisitorCircle, label = "Harbor Home Health"): Promise<Key> {
  const key = { keyId: `agk_${randomBytes(16).toString("base64url")}`, secret: `kin_ags_${randomBytes(32).toString("base64url")}` };
  await asPerson(db.app, circle.userId, (tx) => createAgencyKey(tx, { circleId: circle.circleId, label, keyId: key.keyId, secretHash: sha(key.secret) }));
  return key;
}

async function reportVisit(key: Key, externalId: string, startsAt = "2026-10-28T14:00:00Z", endsAt = "2026-10-28T18:00:00Z") {
  const rawBody = JSON.stringify({ externalId, caregiver: "Amara", kind: "aide", startsAt, endsAt });
  await receiveAgencyVisit(db.app, { keyId: key.keyId, secretHash: sha(key.secret), rawBody, parsed: parseVisitReport(JSON.parse(rawBody) as unknown) });
}

const invoiceBody = (change: Record<string, unknown> = {}) =>
  JSON.stringify({
    invoiceNumber: "INV-2001",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    lines: [
      { visitId: "harbor-1", minutes: 240, amountCents: 8_800, currency: "USD" },
      { visitId: "harbor-2", minutes: 180, amountCents: 6_600, currency: "USD" },
    ],
    totalCents: 15_400,
    currency: "USD",
    dueOn: "2026-11-20",
    paypalEmail: EMAIL,
    ...change,
  });
const send = (key: Key, rawBody: string) => receiveAgencyInvoice(db.app, { keyId: key.keyId, secretHash: sha(key.secret), rawBody, parsed: parseAgencyInvoice(JSON.parse(rawBody) as unknown) });
const status = (key: Key, invoiceNumber = "INV-2001") => agencyInvoiceStatus(db.app, { keyId: key.keyId, secretHash: sha(key.secret), invoiceNumber });

async function invoiced(circle: VisitorCircle) {
  const key = await agency(circle);
  await reportVisit(key, "harbor-1");
  await reportVisit(key, "harbor-2", "2026-10-29T14:00:00Z", "2026-10-29T17:00:00Z");
  const received = await send(key, invoiceBody());
  if (received.state !== "accepted") throw new Error(`Refused: ${received.refusal}`);
  return { key, billId: received.billId, invoiceId: received.id };
}

const review = (circle: VisitorCircle, billId: string, cents = 15_400, persona: Persona = "elena") =>
  asPersona(circle, persona, (tx) => reviewBill(tx, { circleId: circle.circleId, billId, now: CLOCK, review: checkBillReview({ name: "Harbor Home Health", cents, dueOn: "2026-11-20", receiver: EMAIL }) }));

describe("an agency's invoice", () => {
  it("becomes a bill waiting for review for a new payee with no address, and writes no proposal, approval or payment", async () => {
    const circle = await visitorWithCircle(db);
    const before = await db.admin.execute<{ p: string; e: string; l: string }>(sql`select (select count(*) from proposals where circle_id = ${circle.circleId}) as p, (select count(*) from executions where circle_id = ${circle.circleId}) as e, (select count(*) from ledger_entries where circle_id = ${circle.circleId}) as l`);
    const { billId, key } = await invoiced(circle);
    const [bill] = await service(circle, (tx) => tx.select().from(bills).where(eq(bills.id, billId)));
    expect(bill).toMatchObject({ amountCents: 15_400, dueOn: "2026-11-20", state: "needs_review", documentId: null });
    const [payee] = await service(circle, (tx) => tx.select().from(payees).where(eq(payees.id, bill?.payeeId ?? "")));
    expect(payee).toMatchObject({ name: "Harbor Home Health", status: "new", paypalReceiver: null, memberId: null, category: "care" });
    const after = await db.admin.execute(sql`select (select count(*) from proposals where circle_id = ${circle.circleId}) as p, (select count(*) from executions where circle_id = ${circle.circleId}) as e, (select count(*) from ledger_entries where circle_id = ${circle.circleId}) as l`);
    expect(after.rows).toEqual(before.rows);
    expect(await status(key)).toMatchObject({ invoiceNumber: "INV-2001", status: "received", totalCents: 15_400, currency: "USD", payout: null });

    const [shown] = (await asPerson(db.app, circle.userId, (tx) => readAgencyInvoices(tx, circle.circleId))).filter((each) => each.billId === billId);
    expect(shown).toMatchObject({ state: "accepted", invoiceNumber: "INV-2001", paypalEmail: EMAIL, totalCents: 15_400 });
    expect(shown?.lines.map((line) => [line.position, line.visit.externalId, line.minutes, line.amountCents])).toEqual([
      [1, "harbor-1", 240, 8_800],
      [2, "harbor-2", 180, 6_600],
    ]);
  });

  it("is idempotent on the agency's number: the same body is the same answer, another body is refused", async () => {
    const circle = await visitorWithCircle(db);
    const { key, invoiceId, billId } = await invoiced(circle);
    expect(await send(key, invoiceBody())).toEqual({ id: invoiceId, state: "accepted", duplicate: true, billId });
    expect(await reason(send(key, invoiceBody({ dueOn: "2026-12-01" })))).toBe("invoice_conflict");
    expect(await service(circle, (tx) => tx.select().from(bills).where(eq(bills.payeeId, sql`(select payee_id from bills where id = ${billId})`)))).toHaveLength(1);
  });

  it("keeps a line for a visit the circle has no record of, or one already invoiced, as refused with the agency's IDs", async () => {
    const circle = await visitorWithCircle(db);
    const { key } = await invoiced(circle);
    const unknown = await send(key, invoiceBody({ invoiceNumber: "INV-2002", lines: [{ visitId: "never-reported", minutes: 60, amountCents: 100, currency: "USD" }], totalCents: 100 }));
    expect(unknown).toMatchObject({ state: "refused", refusal: "unknown_visit", visits: ["never-reported"] });
    const twice = await send(key, invoiceBody({ invoiceNumber: "INV-2003" }));
    expect(twice).toMatchObject({ state: "refused", refusal: "visit_invoiced", visits: ["harbor-1", "harbor-2"] });
    // Another circle's agency cannot invoice this circle's visits, even under the same name.
    const other = await visitorWithCircle(db);
    const theirs = await agency(other);
    expect(await send(theirs, invoiceBody({ invoiceNumber: "INV-9" }))).toMatchObject({ state: "refused", refusal: "unknown_visit" });
    const raw = await db.admin.execute<{ raw_body: string; refusal: string }>(sql`select raw_body, refusal from agency_invoices where circle_id = ${circle.circleId} and state = 'refused' order by received_at`);
    expect(raw.rows.map((row) => row.refusal)).toEqual(["unknown_visit", "visit_invoiced"]);
    expect(raw.rows[0]?.raw_body).toContain("never-reported");
  });

  it("keeps a body whose total does not add up as refused, and refuses a key that is not live", async () => {
    const circle = await visitorWithCircle(db);
    const key = await agency(circle);
    expect(await send(key, invoiceBody({ totalCents: 15_401 }))).toMatchObject({ state: "refused", refusal: "total" });
    expect(await send(key, invoiceBody({ currency: "EUR", lines: [{ visitId: "harbor-1", minutes: 240, amountCents: 8_800, currency: "EUR" }], totalCents: 8_800 }))).toMatchObject({ state: "refused", refusal: "circle_currency" });
    expect(await reason(send({ keyId: key.keyId, secret: "kin_ags_wrong" }, invoiceBody()))).toBe("refused");
    expect(await reason(status({ keyId: key.keyId, secret: "kin_ags_wrong" }))).toBe("refused");
    expect(await status(key, "INV-NEVER")).toBeNull();
  });

  it("is reviewed like any bill: a payment labelled as the agency's invoice, the reviewer never alone, and the status follows", async () => {
    const circle = await visitorWithCircle(db);
    const { key, billId } = await invoiced(circle);
    const { proposalId } = await review(circle, billId);
    if (!proposalId) throw new Error("No proposal was raised");
    const [proposal] = await service(circle, (tx) => tx.select().from(proposals).where(eq(proposals.id, proposalId)));
    expect(proposal).toMatchObject({ kind: "bill_payment", purpose: "agency_invoice", cents: 15_400, state: "pending_approval", billId });
    // 154.00 is above Rose's 50.00, so she decides; Elena reviewed it, so hers can never be the only yes.
    expect(proposal?.plan).toMatchObject({ slots: [{ reason: "parent_decides", roles: ["parent"] }], announceToCircle: true, raiserMemberId: circle.members.elena });
    expect(await status(key)).toMatchObject({ status: "under_review", payout: null });

    const outcome = await asPersona(circle, "rose", (tx) => answerProposal(tx, { circleId: circle.circleId, memberId: circle.members.rose, role: "parent" }, { proposalId, decision: "approve", method: "app", now: CLOCK, pausedUntil: null }));
    expect(outcome).toBe("approved");
    const [execution] = await service(circle, (tx) => tx.select().from(executions).where(eq(executions.proposalId, proposalId)));
    expect(execution).toMatchObject({ state: "created", receiver: EMAIL });
    expect(await status(key)).toMatchObject({ status: "approved", payout: { state: "created", paypalItemStatus: null, simulated: true } });
  });

  it("can be paid less than invoiced, never more", async () => {
    const circle = await visitorWithCircle(db);
    const { billId } = await invoiced(circle);
    expect(await reason(review(circle, billId, 15_500))).toBe("above_invoice");
    await expect(review(circle, billId, 8_800)).resolves.toMatchObject({ route: "paypal" });
  });

  it("is declined by a member who shares the cost while it waits for review, and its visits may be invoiced again", async () => {
    const circle = await visitorWithCircle(db);
    const { key, billId } = await invoiced(circle);
    for (const persona of ["daniel", "rose"] as const) expect(await reason(asPersona(circle, persona, (tx) => declineAgencyInvoice(tx, { circleId: circle.circleId, billId })))).toBe("refused");
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    expect(await reason(asPerson(db.app, amara, (tx) => declineAgencyInvoice(tx, { circleId: circle.circleId, billId })))).toBe("refused");
    const other = await visitorWithCircle(db);
    expect(await reason(asPerson(db.app, other.userId, (tx) => declineAgencyInvoice(tx, { circleId: circle.circleId, billId })))).toBe("refused");
    // Only an invoiced bill is declined this way.
    const [letterBill] = await service(circle, (tx) => tx.select({ id: bills.id }).from(bills).where(and(eq(bills.circleId, circle.circleId), eq(bills.state, "paid"))).limit(1));
    expect(await reason(asPersona(circle, "elena", (tx) => declineAgencyInvoice(tx, { circleId: circle.circleId, billId: letterBill?.id ?? "" })))).toBe("refused");

    expect(await asPersona(circle, "marcus", (tx) => declineAgencyInvoice(tx, { circleId: circle.circleId, billId }))).toBe(true);
    expect(await asPersona(circle, "marcus", (tx) => declineAgencyInvoice(tx, { circleId: circle.circleId, billId }))).toBe(false);
    expect(await status(key)).toMatchObject({ status: "declined" });
    expect(await send(key, invoiceBody({ invoiceNumber: "INV-2001-B" }))).toMatchObject({ state: "accepted", duplicate: false });
  });

  it("bills a visit once when two keys of the same agency send invoices for it at the same moment", async () => {
    const circle = await visitorWithCircle(db);
    const first = await agency(circle);
    const second = await agency(circle);
    await reportVisit(first, "harbor-1");
    await reportVisit(first, "harbor-2", "2026-10-29T14:00:00Z", "2026-10-29T17:00:00Z");
    // The first invoice is received and its transaction held open; the second, under the other key, starts meanwhile.
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let firstReceived = false;
    const firstBody = invoiceBody({ invoiceNumber: "INV-RACE-A" });
    const firstDone = db.app.transaction(async (tx) => {
      const parsed = parseAgencyInvoice(JSON.parse(firstBody) as unknown);
      if (!parsed.ok) throw new Error("The test invoice does not parse");
      await tx.execute(sql`select kin_private.receive_agency_invoice(${first.keyId}, ${sha(first.secret)}, ${firstBody}, ${JSON.stringify(parsed.invoice)}::jsonb, null)`);
      firstReceived = true;
      await gate;
    });
    while (!firstReceived) await new Promise((resolve) => setTimeout(resolve, 10));
    let secondSettled = false;
    const secondDone = send(second, invoiceBody({ invoiceNumber: "INV-RACE-B" })).finally(() => (secondSettled = true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    // It waits on the visit's lock rather than reading a snapshot that cannot see the first invoice.
    expect(secondSettled).toBe(false);
    release();
    await firstDone;
    expect(await secondDone).toMatchObject({ state: "refused", refusal: "visit_invoiced", visits: ["harbor-1", "harbor-2"] });
    // And a plain race from both keys at once never bills it twice either.
    const results = await Promise.all([send(first, invoiceBody({ invoiceNumber: "INV-RACE-C" })), send(second, invoiceBody({ invoiceNumber: "INV-RACE-D" }))]);
    expect(results.map((result) => result.state)).toEqual(["refused", "refused"]);
    const live = await db.admin.execute<{ n: string }>(sql`select count(*) as n from agency_invoiced_visits where circle_id = ${circle.circleId} and released_at is null and visit_report_id in (select id from agency_visit_reports where external_id like 'harbor-%')`);
    expect(live.rows[0]?.n).toBe("2");
  });

  it("holds a visit on one live invoice in the database itself, whatever writes the claim, and releases it only once", async () => {
    const circle = await visitorWithCircle(db);
    const { invoiceId, billId } = await invoiced(circle);
    const [claim] = (await db.admin.execute<{ id: string; visit_report_id: string }>(sql`select id, visit_report_id from agency_invoiced_visits where invoice_id = ${invoiceId} limit 1`)).rows;
    expect(await errorCode(db.admin.execute(sql`insert into agency_invoiced_visits (id, circle_id, visit_report_id, invoice_id) values (gen_random_uuid(), ${circle.circleId}, ${claim?.visit_report_id ?? ""}, ${invoiceId})`))).toBe("23505");
    expect(await errorCode(db.admin.execute(sql`delete from agency_invoiced_visits where id = ${claim?.id ?? ""}`))).toBe("23001");
    expect(await errorCode(db.admin.execute(sql`update agency_invoiced_visits set invoice_id = invoice_id where id = ${claim?.id ?? ""}`))).toBe("23001");
    await asPersona(circle, "elena", (tx) => declineAgencyInvoice(tx, { circleId: circle.circleId, billId }));
    expect(await errorCode(db.admin.execute(sql`update agency_invoiced_visits set released_at = null where id = ${claim?.id ?? ""}`))).toBe("23001");
  });

  it("never reaches a payee the family approved by sharing its name, and keeps one payee for the agency's later invoices", async () => {
    const circle = await visitorWithCircle(db);
    // Lakeside Water is an approved payee of Rose's circle; a key with its name must not inherit it.
    const key = await agency(circle, "Lakeside Water");
    await reportVisit(key, "harbor-1");
    await reportVisit(key, "harbor-2", "2026-10-29T14:00:00Z", "2026-10-29T17:00:00Z");
    const first = await send(key, invoiceBody({ lines: [{ visitId: "harbor-1", minutes: 240, amountCents: 8_800, currency: "USD" }], totalCents: 8_800 }));
    const second = await send(key, invoiceBody({ invoiceNumber: "INV-2002", lines: [{ visitId: "harbor-2", minutes: 180, amountCents: 6_600, currency: "USD" }], totalCents: 6_600 }));
    if (first.state !== "accepted" || second.state !== "accepted") throw new Error("Refused");
    const payeeOf = async (billId: string) => (await service(circle, (tx) => tx.select({ payeeId: bills.payeeId }).from(bills).where(eq(bills.id, billId))))[0]?.payeeId;
    const payeeId = await payeeOf(first.billId);
    expect(payeeId).not.toBe(circle.payees.water);
    expect(await payeeOf(second.billId)).toBe(payeeId);
    const [payee] = await service(circle, (tx) => tx.select().from(payees).where(eq(payees.id, payeeId ?? "")));
    expect(payee).toMatchObject({ name: "Lakeside Water", status: "new", paypalReceiver: null, autoPayRuleId: null });
  });

  it("refuses, in the database too, lines that do not add up to the total", async () => {
    const circle = await visitorWithCircle(db);
    const key = await agency(circle);
    await reportVisit(key, "harbor-1");
    const forged = { invoiceNumber: "INV-F", periodStart: "2026-10-01", periodEnd: "2026-10-31", lines: [{ visitId: "harbor-1", minutes: 240, amountCents: 100 }], totalCents: 99_900, currency: "USD", dueOn: "2026-11-20", paypalEmail: null };
    expect(await errorCode(db.app.execute(sql`select kin_private.receive_agency_invoice(${key.keyId}, ${sha(key.secret)}, ${JSON.stringify(forged)}, ${JSON.stringify(forged)}::jsonb, null)`))).toBe("23514");
  });

  it("is never changed or deleted, nor its lines", async () => {
    const circle = await visitorWithCircle(db);
    const { invoiceId } = await invoiced(circle);
    expect(await errorCode(db.admin.execute(sql`update agency_invoices set total_cents = 1 where id = ${invoiceId}`))).toBe("23001");
    expect(await errorCode(db.admin.execute(sql`delete from agency_invoices where id = ${invoiceId}`))).toBe("23001");
    expect(await errorCode(db.admin.execute(sql`update agency_invoice_lines set amount_cents = 1 where invoice_id = ${invoiceId}`))).toBe("23001");
    expect(await errorCode(db.admin.execute(sql`delete from agency_invoice_lines where invoice_id = ${invoiceId}`))).toBe("23001");
  });
});
