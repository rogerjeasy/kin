import { expect, test } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { fill } from "../src/i18n/template";
import { startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { maybeScreenshot } from "./support/screenshot";
import { viewports } from "./support/viewports";

const label = fill(english.dashboard.fairness.members.ownCurrency, { currency: "EUR" });

for (const viewport of viewports) {
  test(`Marcus sees his agreed share in euros at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await page.goto("/dashboard/fairness");
    const card = page.getByRole("article").filter({ hasText: label });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Marcus");
    await expect(card).toContainText(/€\s?\d|\d\s?€/);
    await maybeScreenshot(page, "fairness");
    await expectNoHorizontalOverflow(page);
  });
}
