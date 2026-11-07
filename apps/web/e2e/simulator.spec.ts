import { expect, test } from "@playwright/test";

import { startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { viewports } from "./support/viewports";

const SIMULATE = "/dashboard/circle/agreement/simulate";

for (const viewport of [...viewports, { name: "narrow", width: 320, height: 740 }]) {
  test(`the simulator fits at ${viewport.width}×${viewport.height} (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await page.goto(SIMULATE);
    await expect(page.getByRole("heading", { level: 1, name: "Try a what-if" })).toBeVisible();
    await expect(page.getByRole("note").filter({ hasText: "Simulation." })).toContainText("saves nothing and moves no money");
    await page.getByLabel("Marcus’s share (%)").fill("40");
    await page.getByLabel("Ana’s share (%)").fill("30");
    await page.getByLabel("A bill of").fill("900.00");
    await page.getByRole("button", { name: "Run the simulation" }).click();
    await expect(page.getByRole("region", { name: "A bill of $900.00" })).toBeVisible();
    await expect(page.getByText("Marcus’s share: 50% → 40%")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

test("shares that do not total 100 percent are refused, and nothing is saved", async ({ page }) => {
  await startDemo(page);
  await page.goto(SIMULATE);
  await page.getByLabel("Marcus’s share (%)").fill("60");
  await page.getByRole("button", { name: "Run the simulation" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText("The shares must total 100 percent.");
});
