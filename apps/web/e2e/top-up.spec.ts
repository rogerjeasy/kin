import { expect, test, type Page } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { fill } from "../src/i18n/template";
import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { standInPayPal } from "./support/paypal-sdk";
import { laptop, viewports } from "./support/viewports";

const copy = english.dashboard.topUp;
const limits = { min: "$1.00", max: "$5,000.00" };

/**
 * Answers the browser's calls to Kin's top-up routes, so these tests check the
 * screen. The routes themselves, with PayPal and the worker, are tested in
 * src/server/top-ups.test.ts and apps/worker.
 */
async function standInRoutes(page: Page, options: { recordedAfter?: number } = {}): Promise<{ orders: string[] }> {
  const orders: string[] = [];
  let polls = 0;
  await page.route("**/api/top-ups", async (route) => {
    orders.push(route.request().postData() ?? "");
    await route.fulfill({ json: { orderId: "5T37836141355693B" } });
  });
  await page.route("**/api/top-ups/5T37836141355693B/capture", (route) => route.fulfill({ json: { captureId: "3C679366HH908993F" } }));
  await page.route("**/api/top-ups/captures/3C679366HH908993F", (route) => {
    polls += 1;
    return route.fulfill({ json: { recorded: polls > (options.recordedAfter ?? 1) } });
  });
  return { orders };
}

async function openSheet(page: Page) {
  await page.getByRole("button", { name: copy.trigger, exact: true }).click();
  const sheet = page.getByRole("dialog", { name: copy.title });
  await expect(sheet.getByRole("button", { name: "Pay with PayPal" })).toBeVisible();
  return sheet;
}

for (const viewport of viewports) {
  test.describe(`adding money at ${viewport.width}×${viewport.height} (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("the sheet fits, says it is the sandbox, and offers PayPal", async ({ page }) => {
      await standInPayPal(page, "approve");
      await startDemo(page);
      const sheet = await openSheet(page);
      await expect(sheet.getByText(copy.sandbox)).toBeVisible();
      await expect(sheet.getByLabel(copy.amount, { exact: true })).toHaveValue("50.00");
      await expectNoHorizontalOverflow(page);
    });
  });
}

test.describe("adding money", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });

  test("goes from the amount to PayPal to a confirmed entry in the record", async ({ page }) => {
    await standInPayPal(page, "approve");
    const { orders } = await standInRoutes(page);
    await startDemo(page);
    const sheet = await openSheet(page);
    await sheet.getByRole("button", { name: "$25.00" }).click();
    await expect(sheet.getByRole("button", { name: "$25.00" })).toHaveAttribute("aria-pressed", "true");
    await sheet.getByRole("button", { name: "Pay with PayPal" }).click();
    await expect(sheet.getByText(fill(copy.confirmed, { amount: "$25.00" }))).toBeVisible({ timeout: 15_000 });
    expect(orders.map((body) => JSON.parse(body))).toEqual([{ amount: "25.00", locale: "en" }]);
  });

  test("says nothing was charged when the payer closes PayPal, and lets them try again", async ({ page }) => {
    await standInPayPal(page, "cancel");
    await standInRoutes(page);
    await startDemo(page);
    const sheet = await openSheet(page);
    await sheet.getByRole("button", { name: "Pay with PayPal" }).click();
    await expect(sheet.getByText(copy.cancelled)).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Pay with PayPal" })).toBeVisible();
  });

  test("refuses an amount outside the limits before PayPal opens", async ({ page }) => {
    await standInPayPal(page, "approve");
    const { orders } = await standInRoutes(page);
    await startDemo(page);
    const sheet = await openSheet(page);
    for (const amount of ["0.50", "5000.01", "25.005", "abc"]) {
      await sheet.getByLabel(copy.amount, { exact: true }).fill(amount);
      await sheet.getByRole("button", { name: "Pay with PayPal" }).click();
      await expect(sheet.getByRole("alert")).toHaveText(fill(copy.invalid, limits));
      await expect(sheet.getByLabel(copy.amount, { exact: true })).toHaveAttribute("aria-invalid", "true");
    }
    expect(orders).toEqual([]);
  });

  test("works by keyboard: a quick amount, then PayPal's button", async ({ page }) => {
    await standInPayPal(page, "approve");
    await standInRoutes(page);
    await startDemo(page);
    const sheet = await openSheet(page);
    await sheet.getByRole("button", { name: "$100.00" }).focus();
    await page.keyboard.press("Enter");
    await expect(sheet.getByLabel(copy.amount, { exact: true })).toHaveValue("100.00");
    await sheet.getByRole("button", { name: "Pay with PayPal" }).focus();
    await page.keyboard.press("Enter");
    await expect(sheet.getByText(fill(copy.confirmed, { amount: "$100.00" }))).toBeVisible({ timeout: 15_000 });
  });

  test("is offered only to the members who share the cost", async ({ page }) => {
    await standInPayPal(page, "approve");
    await startDemo(page);
    await expect(page.getByRole("button", { name: copy.trigger, exact: true })).toBeVisible();
    for (const name of ["Rose", "Daniel"]) {
      await seatAs(page, name);
      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: copy.trigger, exact: true })).toHaveCount(0);
    }
    await seatAs(page, "Marcus");
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: copy.trigger, exact: true })).toBeVisible();
  });

  test("refuses another site's request to open an order, and a visitor with no session", async ({ request }) => {
    const foreign = await request.post("/api/top-ups", { headers: { origin: "https://evil.example" }, data: { amount: "25.00" } });
    expect(foreign.status()).toBe(403);
    const anonymous = await request.post("/api/top-ups", { headers: { origin: new URL(test.info().project.use.baseURL ?? "").origin }, data: { amount: "25.00" } });
    expect(anonymous.status()).toBe(401);
  });
});
