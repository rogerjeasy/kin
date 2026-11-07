import { expect, test } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { maybeScreenshot } from "./support/screenshot";
import { viewports } from "./support/viewports";

const copy = english.dashboard.mandates;

for (const viewport of viewports) {
  test(`the standing permission Rose gave is shown and fits at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await page.goto("/dashboard/circle/mandates");
    await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
    await expect(page.getByText(copy.statuses.active).first()).toBeVisible();
    await expect(page.getByText("$70.00").first()).toBeVisible();
    await expect(page.getByText(copy.simulated)).toBeVisible();
    await expect(page.getByRole("heading", { name: copy.form.title })).toBeVisible();
    await maybeScreenshot(page, "mandates");
    await expectNoHorizontalOverflow(page);
  });
}

test("an observer reads the permissions but cannot grant one, and a caregiver is sent away", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Daniel");
  await page.goto("/dashboard/circle/mandates");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: copy.form.title })).toHaveCount(0);
  await seatAs(page, "Amara");
  await page.goto("/dashboard/circle/mandates");
  await expect(page).not.toHaveURL(/mandates/);
});

test("the read-back keeps each amount whole in Arabic and fits the phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await startDemo(page);
  await page.goto("/ar/dashboard/circle/mandates");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  // Each amount sits in its own bidirectional isolate, so "$70.00" cannot drift apart inside the sentence.
  await expect(page.getByRole("main")).toContainText(/\u2068[^\u2069]*70[.,]00[^\u2069]*\u2069/);
  await maybeScreenshot(page, "mandates-ar");
  await expectNoHorizontalOverflow(page);
});
