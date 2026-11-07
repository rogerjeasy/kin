import { expect, test } from "@playwright/test";

import arabic from "../src/i18n/dictionaries/ar.json" with { type: "json" };
import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { maybeScreenshot } from "./support/screenshot";
import { viewports } from "./support/viewports";

const copy = english.dashboard.officeLine;

for (const viewport of viewports) {
  test(`the office line answers a scam call with no record at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await page.goto("/dashboard/office-line");
    await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
    await expect(page.getByText(copy.recentTitle)).toBeVisible();
    await expect(page.getByLabel(copy.callerLinesLabel)).toHaveValue(/Harbor Gas Services/);
    await maybeScreenshot(page, "office-line-before");
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: copy.submit }).click();
    const outcome = page.getByRole("status").filter({ hasText: copy.verdictTitle });
    await expect(outcome).toContainText(copy.verdicts.no_match);
    await expect(outcome).toContainText(copy.script.reply_no_record);
    await expect(outcome).toContainText(copy.signals.urgency);
    await maybeScreenshot(page, "office-line-after");
    await expectNoHorizontalOverflow(page);
  });
}

test("a bill already paid is not paid twice, and a real quote is recognised", async ({ page }) => {
  await startDemo(page);
  await page.goto("/dashboard/office-line");
  const outcome = page.getByRole("status").filter({ hasText: copy.verdictTitle });

  await page.getByRole("button", { name: copy.scenarios.paid.label }).click();
  await page.getByRole("button", { name: copy.submit }).click();
  await expect(outcome).toContainText("was already paid to Northfield Gas");

  await page.getByRole("button", { name: copy.scenarios.real.label }).click();
  await page.getByRole("button", { name: copy.submit }).click();
  await expect(outcome).toContainText(copy.verdicts.match);
});

test("the office line reads right to left in Arabic and fits the phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await startDemo(page);
  await page.goto("/ar/dashboard/office-line");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: arabic.dashboard.officeLine.title })).toBeVisible();
  await page.getByRole("button", { name: arabic.dashboard.officeLine.submit }).click();
  await expect(page.getByRole("status").filter({ hasText: arabic.dashboard.officeLine.verdictTitle })).toContainText(arabic.dashboard.officeLine.verdicts.no_match);
  await maybeScreenshot(page, "office-line-ar");
  await expectNoHorizontalOverflow(page);
});
