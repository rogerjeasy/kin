import { expect, test, type APIRequestContext } from "@playwright/test";
import { signAgencyRequest } from "@kin/auth";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { maybeScreenshot } from "./support/screenshot";
import { viewports } from "./support/viewports";

const copy = english.dashboard.bills.invoices;
const agency = english.openKin.agency;
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/gu, (_, key: string) => values[key] ?? "");

/** One signed request from the agency's software: the raw body, or the path for a GET, signed with the key's secret. */
function signedHeaders(key: { keyId: string; secret: string }, signed: string) {
  return { "kin-agency-key": key.keyId, "kin-signature": signAgencyRequest(key.secret, Math.floor(Date.now() / 1000), signed) };
}
const status = async (request: APIRequestContext, key: { keyId: string; secret: string }, number: string) => {
  const path = `/api/v1/invoices/${number}`;
  const response = await request.get(path, { headers: signedHeaders(key, path) });
  return { code: response.status(), body: (await response.json()) as Record<string, unknown> };
};

for (const viewport of viewports) {
  test(`the sample agency invoice waits on Bills, its lines checked, at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await page.goto("/dashboard/bills");
    const panel = page.getByRole("region", { name: copy.title });
    const card = panel.getByRole("listitem", { name: fill(copy.heading, { agency: "Sunrise Home Care", number: "INV-1042" }) });
    await expect(card).toBeVisible();
    await expect(card).toContainText(english.openKin.list.sample);
    await expect(card).toContainText("$224.00");
    // Neither visit has the family's word on Kin's calendar, and the screen says so before anyone says yes.
    await expect(card.getByText(copy.flags.no_family_word)).toHaveCount(2);
    await expect(card).toContainText(fill(copy.warning, { count: "2", total: "2" }));
    await expect(card.getByRole("button", { name: english.dashboard.letters.bills.review.open })).toBeVisible();
    await maybeScreenshot(page, `agency-invoice-${viewport.width}`);
    await expectNoHorizontalOverflow(page);

    await page.goto("/dashboard/circle/connections");
    await expect(page.getByRole("heading", { name: agency.invoices })).toBeVisible();
    await expect(page.getByText(fill(agency.invoice, { agency: "Sunrise Home Care", number: "INV-1042", amount: "$224.00" }))).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

test("an agency signs an invoice with a key made on the connections screen, and the family reviews it on Bills", async ({ page, playwright }) => {
  await startDemo(page);
  await page.goto("/dashboard/circle/connections");
  await page.getByLabel(agency.create.label).fill("Harbor Home Health");
  await page.getByRole("button", { name: agency.create.submit }).click();
  await expect(page.getByRole("heading", { name: agency.create.secretTitle })).toBeVisible();
  const key = { keyId: await page.getByLabel(agency.create.keyId).inputValue(), secret: await page.getByLabel(agency.create.secret).inputValue() };

  const number = `INV-E2E-${Date.now()}`;
  const outside = await playwright.request.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const now = Date.now();
    const visit = JSON.stringify({ externalId: `harbor-${now}`, caregiver: "Amara", kind: "aide", startsAt: new Date(now - 6 * 3_600_000).toISOString(), endsAt: new Date(now - 2 * 3_600_000).toISOString() });
    const reported = await outside.post("/api/v1/visits", { headers: { "content-type": "application/json", ...signedHeaders(key, visit) }, data: visit });
    expect(reported.status()).toBe(201);

    const body = JSON.stringify({ invoiceNumber: number, periodStart: new Date(now - 7 * 86_400_000).toISOString().slice(0, 10), periodEnd: new Date(now).toISOString().slice(0, 10), lines: [{ visitId: `harbor-${now}`, minutes: 240, amountCents: 11_200, currency: "USD" }], totalCents: 11_200, currency: "USD", dueOn: new Date(now + 14 * 86_400_000).toISOString().slice(0, 10), paypalEmail: "billing@harbor.example" });
    const send = (data: string, signed = data) => outside.post("/api/v1/invoices", { headers: { "content-type": "application/json", ...signedHeaders(key, signed) }, data });
    // A tampered amount under the original signature, and a total that is not the sum of its lines, are refused.
    expect((await send(body.replace("11200,\"currency\":\"USD\"}],\"totalCents\":11200", "99900,\"currency\":\"USD\"}],\"totalCents\":99900"), body)).status()).toBe(401);
    expect((await send(body.replace("\"totalCents\":11200", "\"totalCents\":11300").replace(number, `${number}-X`))).status()).toBe(422);
    const sent = await send(body);
    expect(sent.status()).toBe(201);
    expect(await sent.json()).toMatchObject({ status: "received", note: expect.stringContaining("Nothing is paid") });
    expect((await send(body)).status()).toBe(200);
    expect(await status(outside, key, number)).toMatchObject({ code: 200, body: { status: "received", totalCents: 11_200, payout: null } });

    await page.goto("/dashboard/bills");
    const card = page.getByRole("listitem", { name: fill(copy.heading, { agency: "Harbor Home Health", number }) });
    await expect(card).toContainText("$112.00");
    await expect(card).toContainText(copy.flags.no_family_word);
    await expectNoHorizontalOverflow(page);
    await card.getByRole("button", { name: english.dashboard.letters.bills.review.open }).click();
    // The agency's PayPal address starts the review; the reviewer confirms it.
    await expect(card.getByLabel(english.dashboard.letters.bills.review.email)).toHaveValue("billing@harbor.example");
    await card.getByRole("button", { name: english.dashboard.letters.bills.review.submit }).click();
    await expect(card).toContainText(english.dashboard.letters.bills.states.proposed);
    await expectNoHorizontalOverflow(page);
    expect(await status(outside, key, number)).toMatchObject({ code: 200, body: { status: "under_review", payout: null } });

    await page.goto("/dashboard/approvals");
    await expect(page.getByText(fill(english.dashboard.approvals.purposes.agency_invoice.title, { name: "Harbor Home Health" })).first()).toBeVisible();
  } finally {
    await outside.dispose();
  }
});
