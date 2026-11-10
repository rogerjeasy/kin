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

for (const viewport of [viewports[0], viewports[3]]) {
  test(`a scam call for nobody on record is the check the bills and the overview tell, at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await page.goto("/dashboard/office-line");
    await page.getByRole("button", { name: copy.submit }).click();
    await expect(page.getByRole("status").filter({ hasText: copy.verdictTitle })).toContainText(copy.verdicts.no_match);

    await page.goto("/dashboard/bills");
    const checks = page.getByRole("region", { name: english.dashboard.bills.checks.title });
    await expect(checks).toContainText(english.dashboard.checkStory.no_match.title);
    await expect(checks).toContainText(copy.verdicts.no_match);
    await expect(page.getByText(english.dashboard.empty.safety.text)).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await page.goto("/dashboard");
    await expect(page.getByText(english.dashboard.checkStory.no_match.title)).toBeVisible();
    await expect(page.getByText(english.dashboard.empty.safety.text)).toHaveCount(0);
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

test("a bill already paid is named as paid in the pill, not as matching nothing", async ({ page }) => {
  await startDemo(page);
  await page.goto("/dashboard/office-line");
  const outcome = page.getByRole("status").filter({ hasText: copy.verdictTitle });
  await page.getByRole("button", { name: copy.scenarios.paid.label }).click();
  await page.getByRole("button", { name: copy.submit }).click();
  await expect(outcome).toContainText(copy.verdicts.already_paid);
  await expect(outcome).not.toContainText(copy.verdicts.no_match);
  // The same name in the list of recent calls, read back from the database.
  await expect(page.getByRole("region", { name: copy.recentTitle })).toContainText(copy.verdicts.already_paid);
});

test("a call about a bill already paid says so in the pill, and the amount stays whole in Arabic", async ({ page }) => {
  const words = arabic.dashboard.officeLine;
  await page.setViewportSize({ width: 360, height: 740 });
  await startDemo(page);
  await page.goto("/ar/dashboard/office-line");
  await page.getByRole("button", { name: words.scenarios.paid.label }).click();
  await page.getByRole("button", { name: words.submit }).click();
  const outcome = page.getByRole("status").filter({ hasText: words.verdictTitle });
  await expect(outcome).toContainText(words.verdicts.already_paid);
  await expect(outcome).not.toContainText(words.verdicts.no_match);
  // Each amount sits in its own bidirectional isolate, so "$57.00" cannot drift apart inside the sentence.
  await expect(outcome).toContainText(/\u2068[^\u2069]*57[.,]00[^\u2069]*\u2069/);
  await maybeScreenshot(page, "office-line-ar-paid");
  await expectNoHorizontalOverflow(page);
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
