import { expect, test } from "@playwright/test";

import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { viewports } from "./support/viewports";

for (const viewport of viewports) {
  test(`the family asks Kin to reorder and Rose is asked to approve it at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await page.goto("/dashboard/approvals");

    const refills = page.getByRole("region", { name: "Refills" });
    await expect(refills).toContainText("Monthly prescription refill (30 days)");
    await expect(refills).toContainText("$64.00");
    await expect(refills).toContainText("No refill has been proposed yet.");
    await expectNoHorizontalOverflow(page);

    await refills.getByRole("button", { name: "Ask Kin to reorder" }).click();
    // One refill waits at a time, so the button gives way to a note and the cost counts against the month.
    await expect(refills).toContainText("A refill is already waiting for a yes or on its way.");
    await expect(refills.getByRole("button", { name: "Ask Kin to reorder" })).toHaveCount(0);
    await expect(refills).toContainText("$86.00 of $150.00 left this month");
    await expect(page.getByRole("article").filter({ hasText: "Elm Street Pharmacy refill" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // The parent decides above $50: Rose is asked, and her yes sends the order to be bought.
    await seatAs(page, "Rose");
    await page.goto("/dashboard/approvals");
    const waiting = page.getByRole("article").filter({ hasText: "Elm Street Pharmacy refill" });
    await expect(waiting).toContainText("$64.00");
    await waiting.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("region", { name: "Refills" })).toContainText("Said yes, being bought");
    await expectNoHorizontalOverflow(page);
  });
}

test("a caregiver sees no refills at all", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Amara");
  await page.goto("/dashboard/approvals");
  await expect(page.getByRole("region", { name: "Refills" })).toHaveCount(0);
});

test("the observer sees the refill rule but is not offered the button", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Daniel");
  await page.goto("/dashboard/approvals");
  const refills = page.getByRole("region", { name: "Refills" });
  await expect(refills).toContainText("Monthly prescription refill (30 days)");
  await expect(refills.getByRole("button", { name: "Ask Kin to reorder" })).toHaveCount(0);
});
