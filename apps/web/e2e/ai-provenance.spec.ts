import { expect, test } from "@playwright/test";

import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { viewports } from "./support/viewports";

const LETTER = "Greenway Power\nAmount due: $86.40\nPlease pay by 2026-11-20.";

for (const viewport of viewports) {
  test.describe(`who read it, and the evidence, at ${viewport.width}×${viewport.height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
    });

    test("one press reads the sample letter photo with Claude, and the result says so and names the model", async ({ page }) => {
      await startDemo(page);
      await page.goto("/dashboard/bills");
      const reader = page.getByRole("region", { name: "Hold up a letter" });
      await expectNoHorizontalOverflow(page);

      await reader.getByRole("button", { name: "Try a sample letter photo" }).click();
      const result = reader.getByRole("status");
      await expect(result).toContainText("Read by Claude");
      await expect(result).toContainText("Model: ");
      await expect(result).toContainText("Kin read a photograph. Check the amount against the letter.");
      // A photograph has no typed words to check against, so Claude's quote is shown as only its word.
      await expect(result).toContainText("Kin cannot check that against typed words");
      await expect(result.locator("mark")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    });

    test("a typed letter's fields are shown with the words they were found in, marked in the original", async ({ page }) => {
      await startDemo(page);
      await page.goto("/dashboard/bills");
      const reader = page.getByRole("region", { name: "Hold up a letter" });
      await reader.getByLabel("Or type or paste what it says").fill(LETTER);
      await reader.getByRole("button", { name: "Read it to me" }).click();

      const result = reader.getByRole("status");
      await expect(result).toContainText("Read by Claude");
      await expect(result).toContainText("Written in the letter as “Amount due: $86.40”");
      await expect(result).toContainText("Marked words are the evidence");
      await expect(result.locator("mark").filter({ hasText: "Amount due: $86.40" })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // The list beside it remembers who read the letter.
      await expect(page.getByRole("region", { name: "Bills read from letters" })).toContainText("Read by Claude");
    });

    test("a demand's wording says who worded it", async ({ page }) => {
      await startDemo(page);
      await page.goto("/dashboard/bills");
      const check = page.getByRole("region", { name: "Check a demand for money" });
      await check.getByLabel("Who is asking?").fill("Northfield Gas");
      await check.getByLabel("How much do they want?").fill("57.00");
      await check.getByRole("button", { name: "Check this demand" }).click();
      await expect(check.getByRole("status")).toContainText("Worded by Claude");
      await expectNoHorizontalOverflow(page);
    });

    test("the family tries how a caregiver bills without switching seats, and nothing is billed", async ({ page }) => {
      await startDemo(page);
      await page.goto("/dashboard/bills");
      const preview = page.getByRole("region", { name: "Try it: how a caregiver bills by voice or words" });
      await expect(preview).toContainText("Preview");
      await expect(preview.getByLabel("What the caregiver says")).toHaveValue("Monday and Tuesday this week, 4 hours each, and on Thursday from 9 to 11:30 in the morning.");
      await expectNoHorizontalOverflow(page);

      await preview.getByLabel("What the caregiver says").fill("Yesterday 3 hours");
      await preview.getByRole("button", { name: "Preview what Kin reads" }).click();
      const result = preview.getByRole("status");
      await expect(result).toContainText("Read by Claude");
      await expect(result).toContainText("3 h");
      await expect(result).toContainText("Read from “Yesterday 3 hours”");
      await expect(result.locator("mark")).toHaveText("Yesterday 3 hours");
      await expect(result).toContainText("No bill was made and nothing was saved.");
      await expectNoHorizontalOverflow(page);

      // A caregiver has no preview panel: the real form is theirs.
      await seatAs(page, "Amara");
      await page.goto("/dashboard/bills");
      await expect(page.getByRole("region", { name: "Try it: how a caregiver bills by voice or words" })).toHaveCount(0);
    });
  });
}
