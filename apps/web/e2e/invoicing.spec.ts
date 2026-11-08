import { expect, test, type Page } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { fill } from "../src/i18n/template";
import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { laptop, viewports } from "./support/viewports";

// The e2e server sets no KIN_DEMO_INVOICE_RECIPIENT_EMAIL, so the demo's invoices are simulated and say so.
const copy = english.invoicing;
const settle = english.dashboard.fairness.settlement;

async function openFairness(page: Page) {
  await page.goto("/dashboard/fairness");
  await expect(page.getByRole("heading", { level: 1, name: "Fairness" })).toBeVisible();
}

/** The settlement's row for what it collects from Marcus. */
const marcusCollection = (page: Page) => page.getByRole("region", { name: settle.collections }).getByRole("listitem").filter({ hasText: fill(settle.collection, { name: "Marcus" }) });

for (const viewport of viewports) {
  test(`requests by PayPal invoice fit at ${viewport.width}×${viewport.height} (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await openFairness(page);
    const row = marcusCollection(page);
    await expect(row.getByText(copy.notRequested)).toBeVisible();
    const panel = page.getByRole("region", { name: copy.title });
    await expect(panel.getByRole("form", { name: copy.topUp.title })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await row.getByRole("button", { name: copy.request }).click();
    await expect(row.getByText(copy.states.requested)).toBeVisible();
    await expect(row.getByText(copy.simulated, { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: copy.check })).toBeVisible();
    await expect(panel.getByRole("listitem").filter({ hasText: "Marcus" }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if (viewport.name === "phone" || viewport.name === "laptop") await page.screenshot({ path: test.info().outputPath(`invoicing-${viewport.name}.png`), fullPage: true });
  });
}

test.describe("a request by PayPal invoice", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });

  test("is asked by the organizer, read by the family, and withdrawn by keyboard", async ({ page }) => {
    await startDemo(page);
    await openFairness(page);
    const row = marcusCollection(page);
    await row.getByRole("button", { name: copy.request }).focus();
    await page.keyboard.press("Enter");
    await expect(row.getByText(copy.simulatedNote)).toBeVisible();

    // Ana reads it and has nothing to press: only an organizer asks or withdraws, only Marcus may check.
    await seatAs(page, "Ana");
    await openFairness(page);
    await expect(marcusCollection(page).getByText(copy.states.requested)).toBeVisible();
    await expect(page.getByRole("button", { name: copy.request })).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.cancel })).toHaveCount(0);
    await expect(page.getByRole("form", { name: copy.topUp.title })).toHaveCount(0);

    await seatAs(page, "Elena");
    await openFairness(page);
    await marcusCollection(page).getByRole("button", { name: copy.cancel }).click();
    await expect(marcusCollection(page).getByText(copy.states.cancelled)).toBeVisible();
    // A withdrawn request can be asked for again.
    await expect(marcusCollection(page).getByRole("button", { name: copy.request })).toBeVisible();
  });

  test("asks a member for a top-up, refusing an amount below the limit", async ({ page }) => {
    await startDemo(page);
    await openFairness(page);
    const form = page.getByRole("form", { name: copy.topUp.title });
    await form.getByLabel(copy.topUp.member).selectOption({ label: "Ana" });
    await form.getByLabel(copy.topUp.amount).fill("0.50");
    await form.getByRole("button", { name: copy.topUp.submit }).click();
    await expect(form.getByRole("alert")).toHaveText(copy.errors.too_small);
    await form.getByLabel(copy.topUp.amount).fill("75.00");
    await form.getByRole("button", { name: copy.topUp.submit }).click();
    await expect(form.getByRole("status")).toHaveText(copy.topUp.sent);
    const panel = page.getByRole("region", { name: copy.title });
    await expect(panel.getByRole("listitem").filter({ hasText: "Ana" }).filter({ hasText: "$75.00" })).toBeVisible();
  });
});
