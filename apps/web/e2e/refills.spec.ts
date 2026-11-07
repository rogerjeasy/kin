import { expect, test } from "@playwright/test";

import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { viewports } from "./support/viewports";

for (const viewport of viewports) {
  test(`a refill inside Rose's standing permission is bought without asking her at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await page.goto("/dashboard/approvals");

    const refills = page.getByRole("region", { name: "Refills" });
    await expect(refills).toContainText("Monthly prescription refill (30 days)");
    await expect(refills).toContainText("$64.00");
    await expect(refills).toContainText("No refill has been proposed yet.");
    await expectNoHorizontalOverflow(page);

    await refills.getByRole("button", { name: "Ask Kin to reorder" }).click();
    // The permission covers $64.00 once a month, so nobody is asked and the purchase is already approved.
    // The button's own confirmation lasts only until the page refreshes, so the test reads the order, which stays.
    await expect(refills).toContainText("Under a standing permission");
    await expect(refills).toContainText("Said yes, being bought");
    await expect(refills).toContainText("$86.00 of $150.00 left this month");
    await expectNoHorizontalOverflow(page);

    // The permission shows what it allows, read back in full, and what this month has used.
    await refills.getByRole("link", { name: "Standing permissions" }).click();
    await expect(page.getByRole("heading", { name: "Standing permissions", level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("up to $70.00 each time and $70.00 in a month");
    await expect(page.getByRole("main")).toContainText("$64.00 of $70.00 used this month");
    await expect(page.getByRole("main")).toContainText("usual limit by up to $20.00");
    await expect(page.getByRole("main")).toContainText("You may order Monthly prescription refill (30 days) from Elm Street Pharmacy");
    await expectNoHorizontalOverflow(page);
  });
}

test("with the permission ended, the family asks Kin to reorder and Rose is asked to approve it", async ({ page }) => {
  await startDemo(page);
  await page.goto("/dashboard/circle/mandates");
  await page.getByRole("button", { name: "End it" }).click();
  await expect(page.getByRole("main")).toContainText("Ended");

  await page.goto("/dashboard/approvals");
  const refills = page.getByRole("region", { name: "Refills" });
  await refills.getByRole("button", { name: "Ask Kin to reorder" }).click();
  await expect(refills).toContainText("A refill is already waiting for a yes or on its way.");
  await expect(page.getByRole("article").filter({ hasText: "Elm Street Pharmacy refill" })).toBeVisible();

  // The parent decides above $50: Rose is asked, and her yes sends the order to be bought.
  await seatAs(page, "Rose");
  await page.goto("/dashboard/approvals");
  const waiting = page.getByRole("article").filter({ hasText: "Elm Street Pharmacy refill" });
  await expect(waiting).toContainText("$64.00");
  await waiting.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("region", { name: "Refills" })).toContainText("Said yes, being bought");
});

test("a new permission is read back before it is recorded, and one above what it allows falls back to asking", async ({ page }) => {
  await startDemo(page);
  await page.goto("/dashboard/circle/mandates");
  await page.getByRole("button", { name: "End it" }).click();
  await expect(page.getByRole("main")).toContainText("Ended");

  await page.getByLabel("Most for one purchase").fill("60.00");
  await page.getByLabel("Most in a month").fill("60.00");
  await page.getByRole("button", { name: "Read it back" }).click();
  await expect(page.getByText("Kin reads this back")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("up to $60.00 each time and $60.00 in a month");
  // $60.00 is above the $50.00 Rose usually decides herself, so the read-back says she is saying yes ahead of time.
  await expect(page.getByRole("main")).toContainText("yes ahead of time to amounts above the $50.00");
  await page.getByRole("button", { name: /^Confirm: .* said yes ahead of time$/ }).click();
  await expect(page.getByText("Recorded. The next refill inside it is bought without asking.")).toBeVisible();

  // $64.00 is more than the $60.00 she allowed, so Kin says why and asks.
  await page.goto("/dashboard/approvals");
  const refills = page.getByRole("region", { name: "Refills" });
  await refills.getByRole("button", { name: "Ask Kin to reorder" }).click();
  await expect(refills).toContainText("the price is more than was allowed for one purchase");
});

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
