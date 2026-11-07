import { expect, test, type Page } from "@playwright/test";

import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { viewports } from "./support/viewports";

const FAIRNESS = "/dashboard/fairness";
const LONG = "Elm Street Pharmacy and the corner shop, wound dressings, hand cream and the heavier winter socks";

async function openFairness(page: Page) {
  await page.goto(FAIRNESS);
  await expect(page.getByRole("heading", { level: 1, name: "Fairness" })).toBeVisible();
}

async function fileReceipt(page: Page, change: { amount?: string; description?: string } = {}) {
  const form = page.getByRole("form", { name: "File a receipt" });
  await form.getByLabel("Amount").fill(change.amount ?? "42.00");
  await form.getByLabel("What and where").fill(change.description ?? "Elm Street Pharmacy, dressings");
  await form.getByRole("button", { name: "File receipt" }).click();
  await expect(form.getByRole("status").filter({ hasText: "Receipt filed." })).toBeVisible();
}

for (const viewport of viewports) {
  test(`receipts and the settlement fit at ${viewport.width}×${viewport.height} (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await openFairness(page);
    await fileReceipt(page, { amount: "1234.56", description: LONG });
    const receipts = page.getByRole("region", { name: "Receipts" });
    await expect(receipts).toContainText(LONG);
    await expect(receipts).toContainText("$1,234.56");
    await expect(page.getByRole("form", { name: "File a receipt" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if (viewport.name === "phone" || viewport.name === "laptop") await page.screenshot({ path: test.info().outputPath(`receipts-${viewport.name}.png`), fullPage: true });
  });
}

test("a receipt is filed by one member and decided by another, never by the member it would credit", async ({ page }) => {
  await startDemo(page);
  await openFairness(page);
  await fileReceipt(page);
  const receipts = page.getByRole("region", { name: "Receipts" });
  await expect(receipts).toContainText("Elm Street Pharmacy, dressings");
  await expect(receipts).toContainText("Waiting for another member");
  // Elena filed it, so she is told someone else decides, and has no button to decide with.
  await expect(receipts).toContainText("Another member decides on yours.");
  await expect(receipts.getByRole("button", { name: "Approve" })).toHaveCount(0);

  await seatAs(page, "Marcus");
  await openFairness(page);
  await receipts.getByRole("button", { name: "Approve" }).click();
  await expect(receipts).toContainText("Approved · being counted");
  await expect(receipts.getByRole("button", { name: "Approve" })).toHaveCount(0);
});

test("a declined receipt stays declined", async ({ page }) => {
  await startDemo(page);
  await openFairness(page);
  await fileReceipt(page, { amount: "9.99", description: "A mistake" });
  await seatAs(page, "Ana");
  await openFairness(page);
  const receipts = page.getByRole("region", { name: "Receipts" });
  await receipts.getByRole("button", { name: "Decline" }).click();
  await expect(receipts).toContainText("Not approved");
  await expect(receipts.getByRole("button", { name: "Decline" })).toHaveCount(0);
});

test("a receipt with an amount the money core refuses is not filed, and what was typed is kept", async ({ page }) => {
  await startDemo(page);
  await openFairness(page);
  const form = page.getByRole("form", { name: "File a receipt" });
  await form.getByLabel("Amount").fill("12e3");
  await form.getByLabel("What and where").fill("A typo");
  await form.getByRole("button", { name: "File receipt" }).click();
  await expect(form.getByRole("alert")).toHaveText("Check the amount, the day and the description, then try again.");
  await expect(form.getByLabel("What and where")).toHaveValue("A typo");
  await expect(page.getByRole("region", { name: "Receipts" })).toContainText("No receipts have been filed yet.");
});

test("the settlement's payments are followed on the same screen, and only members who share the cost file receipts", async ({ page }) => {
  await startDemo(page);
  await openFairness(page);
  // The demo month's settlement is already with the family, so there is nothing more to send.
  const run = page.getByRole("region", { name: "Pay out the settlement" });
  await expect(run.getByRole("region", { name: "Payments from this settlement" })).toContainText("Waiting for approval");
  await expect(run.getByRole("button", { name: "Send for approval" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await seatAs(page, "Daniel");
  await openFairness(page);
  await expect(page.getByRole("region", { name: "Receipts" })).toBeVisible();
  await expect(page.getByRole("form", { name: "File a receipt" })).toHaveCount(0);
});
