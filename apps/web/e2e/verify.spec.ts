import { expect, test } from "@playwright/test";

import arabic from "../src/i18n/dictionaries/ar.json" with { type: "json" };
import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { maybeScreenshot } from "./support/screenshot";
import { viewports } from "./support/viewports";

const copy = english.dashboard.verify;

for (const viewport of viewports) {
  test(`the record check passes and offers the export at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await page.goto("/dashboard/record/verify");
    await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
    await expect(page.getByText(copy.pass).first()).toBeVisible();
    await expect(page.getByText(copy.fail)).toHaveCount(0);
    await expect(page.getByRole("link", { name: copy.download })).toHaveAttribute("href", /\/dashboard\/record\/verify\/export$/);
    await expect(page.getByText("kin-verify")).toBeVisible();
    await maybeScreenshot(page, "verify");
    await expectNoHorizontalOverflow(page);
  });
}

test("the export link serves the record as JSON", async ({ page }) => {
  await startDemo(page);
  await page.goto("/dashboard/record/verify");
  const href = await page.getByRole("link", { name: copy.download }).getAttribute("href");
  const reply = await page.request.get(href ?? "");
  expect(reply.ok()).toBe(true);
  expect(await reply.json()).toHaveProperty("entries");
});

test("the record check reads right to left in Arabic and fits the phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await startDemo(page);
  await page.goto("/ar/dashboard/record/verify");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: arabic.dashboard.verify.title })).toBeVisible();
  await expect(page.getByText(arabic.dashboard.verify.pass).first()).toBeVisible();
  await maybeScreenshot(page, "verify-ar");
  await expectNoHorizontalOverflow(page);
});
