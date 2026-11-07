import { expect, test } from "@playwright/test";

import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { viewports } from "./support/viewports";

const STATEMENT = "/dashboard/record/statement";

for (const viewport of viewports) {
  test(`the statement fits at ${viewport.width}×${viewport.height} (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await page.goto(STATEMENT);
    await expect(page.getByRole("heading", { level: 1, name: "Statement" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Contributions" })).toContainText("Marcus");
    await expect(page.getByRole("region", { name: "Caregiver pay" })).toContainText("Amara");
    await expect(page.getByRole("region", { name: "Expected next month" })).toContainText("Gas");
    await expect(page.getByRole("region", { name: / in review$/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

test("the record links to the statement, and the audit export downloads", async ({ page }) => {
  await startDemo(page);
  await page.goto("/dashboard/record");
  await page.getByRole("link", { name: "Monthly statement and year in review" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Statement" })).toBeVisible();
  const audit = await page.request.get("/dashboard/record/audit");
  expect(audit.status()).toBe(200);
  expect(audit.headers()["content-type"]).toContain("text/csv");
  expect((await audit.text()).split("\r\n")[0]).toContain("Entry ID");
});

test("printing hides the navigation and keeps the figures", async ({ page }) => {
  await startDemo(page);
  await page.goto(STATEMENT);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("navigation", { name: "Month" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeHidden();
  await expect(page.getByRole("region", { name: "Contributions" })).toBeVisible();
});

test("a caregiver may not open the statement or the audit export", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Amara");
  await page.goto(STATEMENT);
  await expect(page.getByRole("heading", { level: 1, name: "Statement" })).toBeHidden();
  expect((await page.request.get("/dashboard/record/audit")).status()).toBe(403);
});
