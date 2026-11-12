import { agencySecret, hashAgencySecret, newAgencyKeyId, signAgencyRequest } from "@kin/auth";
import { asPerson, createAgencyKey, readCircle } from "@kin/db";
import { serviceRows, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { parseAgencyInvoice } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { runBillPayment } from "../bill-payments";
import { receiveVisit } from "./agency";
import { invoiceStatus, receiveInvoice } from "./agency-invoices";
import { INVOICE_EXAMPLE, openApiDocument } from "./openapi";
import { testDatabases } from "../../../../../packages/db/src/testing/databases.ts";

const db = testDatabases();
const ORIGIN = "https://kin.test";
const SIGNING_KEY = "a signing key for agency secrets in this test, long enough";
const NOW = new Date("2026-11-09T12:00:00Z");
const NOW_SECONDS = NOW.getTime() / 1000;
const services = (signingKey: string | null = SIGNING_KEY) => ({ db: db.app, signingKey, now: () => NOW });

type Key = { readonly keyId: string; readonly secret: string };

async function agencyKey(circle: VisitorCircle, label = "Harbor Home Health"): Promise<Key> {
  const keyId = newAgencyKeyId();
  const secret = agencySecret(SIGNING_KEY, keyId);
  await asPerson(db.app, circle.userId, (tx) => createAgencyKey(tx, { circleId: circle.circleId, label, keyId, secretHash: hashAgencySecret(secret) }));
  return { keyId, secret };
}

const headers = (key: Key, signature: string) => ({ "content-type": "application/json", "kin-agency-key": key.keyId, "kin-signature": signature });

async function reportVisit(key: Key, externalId: string) {
  const body = JSON.stringify({ externalId, caregiver: "Amara", kind: "aide", startsAt: "2026-11-02T14:00:00Z", endsAt: "2026-11-02T18:00:00Z" });
  const response = await receiveVisit(new Request(`${ORIGIN}/api/v1/visits`, { method: "POST", headers: headers(key, signAgencyRequest(key.secret, NOW_SECONDS, body)), body }), services());
  expect(response.status).toBe(201);
}

const invoice = (change: Record<string, unknown> = {}) =>
  JSON.stringify({
    invoiceNumber: "INV-3001",
    periodStart: "2026-11-01",
    periodEnd: "2026-11-08",
    lines: [{ visitId: "harbor-7", minutes: 240, amountCents: 11_200, currency: "USD" }],
    totalCents: 11_200,
    currency: "USD",
    dueOn: "2026-11-30",
    paypalEmail: "billing@harbor.example",
    ...change,
  });

const post = (key: Key, body: string, change: { signature?: string; at?: number; signingKey?: string | null } = {}) =>
  receiveInvoice(
    new Request(`${ORIGIN}/api/v1/invoices`, { method: "POST", headers: headers(key, change.signature ?? signAgencyRequest(key.secret, change.at ?? NOW_SECONDS, body)), body }),
    services(change.signingKey === undefined ? SIGNING_KEY : change.signingKey),
  );

const get = (key: Key, number: string, change: { signed?: string; at?: number } = {}) => {
  const path = `/api/v1/invoices/${number}`;
  return invoiceStatus(new Request(`${ORIGIN}${path}`, { method: "GET", headers: { "kin-agency-key": key.keyId, "kin-signature": signAgencyRequest(key.secret, change.at ?? NOW_SECONDS, change.signed ?? path) } }), number, services());
};

async function withVisit() {
  const circle = await visitorWithCircle(db);
  const key = await agencyKey(circle);
  await reportVisit(key, "harbor-7");
  return { circle, key };
}

describe("POST /api/v1/invoices", () => {
  it("keeps a signed invoice as a bill for review, says it pays nothing, and is idempotent on the agency's number", async () => {
    const { circle, key } = await withVisit();
    const first = await post(key, invoice());
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ status: "received", duplicate: false, note: expect.stringContaining("Nothing is paid until a person in Kin reviews it") });
    expect((await post(key, invoice())).status).toBe(200);
    expect((await post(key, invoice({ dueOn: "2026-12-01" }))).status).toBe(409);
    const bills = await serviceRows(db, circle.circleId, "select b.state, b.amount_cents from bills b join agency_invoices i on i.bill_id = b.id where b.circle_id = $1", [circle.circleId]);
    expect(bills.filter((row) => row["amount_cents"] === "11200")).toEqual([{ state: "needs_review", amount_cents: "11200" }]);
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from proposals p join agency_invoices i on i.bill_id = p.bill_id where p.circle_id = $1", [circle.circleId])).toEqual([{ n: 0 }]);
  });

  it("refuses a forged signature, a replay outside the window, an unknown key and a deployment without a signing key, storing nothing", async () => {
    const { circle, key } = await withVisit();
    const before = await serviceRows(db, circle.circleId, "select count(*)::int as n from agency_invoices where circle_id = $1", [circle.circleId]);
    expect((await post(key, invoice(), { signature: signAgencyRequest(agencySecret(SIGNING_KEY, newAgencyKeyId()), NOW_SECONDS, invoice()) })).status).toBe(401);
    expect((await post(key, invoice(), { at: NOW_SECONDS - 301 })).status).toBe(401);
    expect((await post(key, invoice(), { at: NOW_SECONDS + 301 })).status).toBe(401);
    expect((await post({ keyId: newAgencyKeyId(), secret: key.secret }, invoice())).status).toBe(401);
    // A signature over one body does not carry another: the amount cannot be changed in flight.
    expect((await post(key, invoice({ totalCents: 1_120_000, lines: [{ visitId: "harbor-7", minutes: 240, amountCents: 1_120_000, currency: "USD" }] }), { signature: signAgencyRequest(key.secret, NOW_SECONDS, invoice()) })).status).toBe(401);
    expect((await post(key, invoice(), { signingKey: null })).status).toBe(503);
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from agency_invoices where circle_id = $1", [circle.circleId])).toEqual(before);
  });

  it("keeps a total that is not the sum of its lines, and a line for an unknown visit, as refused with why", async () => {
    const { circle, key } = await withVisit();
    const mismatch = await post(key, invoice({ totalCents: 11_201 }));
    expect(mismatch.status).toBe(422);
    expect(await mismatch.json()).toMatchObject({ status: "refused", reason: "total" });
    const unknown = await post(key, invoice({ invoiceNumber: "INV-3002", lines: [{ visitId: "never-sent", minutes: 60, amountCents: 100, currency: "USD" }], totalCents: 100 }));
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toMatchObject({ reason: "unknown_visit", visits: ["never-sent"] });
    const notJson = await post(key, "{not json");
    expect(await notJson.json()).toMatchObject({ reason: "shape" });
    const kept = await serviceRows(db, circle.circleId, "select refusal from agency_invoices where circle_id = $1 and state = 'refused' order by received_at", [circle.circleId]);
    expect(kept).toEqual([{ refusal: "total" }, { refusal: "unknown_visit" }, { refusal: "shape" }]);
  });

  it("lets no agency invoice another circle's visits, nor read another circle's invoice", async () => {
    const { key } = await withVisit();
    expect((await post(key, invoice())).status).toBe(201);
    const other = await visitorWithCircle(db);
    const theirs = await agencyKey(other);
    const crossed = await post(theirs, invoice({ invoiceNumber: "INV-X" }));
    expect(await crossed.json()).toMatchObject({ reason: "unknown_visit" });
    expect((await get(theirs, "INV-3001")).status).toBe(404);
  });
});

describe("the invoice operations in the OpenAPI document", () => {
  it("are tagged for SDK generators, and publish an example the server itself accepts", () => {
    const document = openApiDocument(ORIGIN) as { tags: { name: string }[]; paths: Record<string, Record<string, { tags?: string[] }>>; components: { schemas: Record<string, { examples?: unknown[] }> } };
    expect(document.tags.map((tag) => tag.name)).toEqual(["Agency", "MCP"]);
    expect(document.paths["/api/v1/invoices"]?.["post"]?.tags).toEqual(["Agency"]);
    expect(document.paths["/api/v1/invoices/{number}"]?.["get"]?.tags).toEqual(["Agency"]);
    expect(parseAgencyInvoice(INVOICE_EXAMPLE)).toMatchObject({ ok: true });
    expect(document.components.schemas["AgencyInvoice"]?.examples).toEqual([INVOICE_EXAMPLE]);
    for (const name of ["InvoiceReceipt", "InvoiceRefusal", "InvoiceStatus"]) expect(document.components.schemas[name]?.examples).toHaveLength(1);
  });
});

describe("GET /api/v1/invoices/{number}", () => {
  it("answers the agency with the status and nothing about the family, following the review", async () => {
    const { circle, key } = await withVisit();
    await post(key, invoice());
    const received = await get(key, "INV-3001");
    expect(received.status).toBe(200);
    const body = (await received.json()) as Record<string, unknown>;
    expect(body).toEqual({ invoiceNumber: "INV-3001", status: "received", totalCents: 11_200, currency: "USD", receivedAt: expect.any(String), payout: null });

    const snapshot = await asPerson(db.app, circle.userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId: circle.userId, now: new Date("2026-10-30T18:00:00Z") }));
    const [row] = await serviceRows(db, circle.circleId, "select i.bill_id from agency_invoices i where i.circle_id = $1 and i.invoice_number = 'INV-3001'", [circle.circleId]);
    const reviewed = await runBillPayment({ db: db.app, userId: circle.userId, circle: snapshot }, { operation: "review", billId: row?.["bill_id"], name: "Harbor Home Health", amount: "112.00", dueOn: "2026-11-30", receiver: "billing@harbor.example" });
    expect(reviewed).toMatchObject({ ok: true, route: "paypal" });
    expect(await (await get(key, "INV-3001")).json()).toMatchObject({ status: "under_review", payout: null });
  });

  it("is signed over its own path: a signature for another number, or over a body, or outside the window is refused", async () => {
    const { key } = await withVisit();
    await post(key, invoice());
    expect((await get(key, "INV-3001", { signed: "/api/v1/invoices/INV-3002" })).status).toBe(401);
    expect((await get(key, "INV-3001", { signed: "" })).status).toBe(401);
    expect((await get(key, "INV-3001", { at: NOW_SECONDS - 600 })).status).toBe(401);
    expect((await get(key, "INV-9999")).status).toBe(404);
    expect((await get(key, "..%2F..%2Fbills")).status).toBe(404);
  });
});
