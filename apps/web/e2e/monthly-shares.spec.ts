import { expect, test, type Page } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { fill } from "../src/i18n/template";
import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { laptop, viewports } from "./support/viewports";

const copy = english.dashboard.monthly;

async function openCircle(page: Page) {
  await startDemo(page);
  await page.goto("/dashboard/circle");
  const panel = page.getByRole("region", { name: copy.title });
  await expect(panel).toBeVisible();
  return panel;
}

for (const viewport of viewports) {
  test.describe(`monthly shares at ${viewport.width}×${viewport.height} (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("the panel, its form and a running share fit with no sideways scroll", async ({ page }) => {
      const panel = await openCircle(page);
      await expect(panel.getByLabel(copy.amount)).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await panel.getByLabel(copy.amount).fill("1234.56");
      await panel.getByRole("button", { name: copy.start }).click();
      await expect(panel.getByText(fill(copy.perMonth, { amount: "$1,234.56" }))).toBeVisible();
      await expect(panel.getByRole("button", { name: copy.pause })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  });
}

test.describe("a monthly share", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });

  test("starts simulated in the demo, pauses, resumes and ends, and every member can read it", async ({ page }) => {
    const panel = await openCircle(page);
    await expect(panel.getByText(copy.empty)).toBeVisible();
    await expect(panel.getByText(copy.demoNote)).toBeVisible();

    await panel.getByLabel(copy.amount).fill("150.00");
    await panel.getByRole("button", { name: copy.start }).click();
    const row = panel.getByRole("listitem").filter({ hasText: fill(copy.perMonth, { amount: "$150.00" }) });
    await expect(row.getByText(copy.states.active)).toBeVisible();
    await expect(row.getByText(english.dashboard.common.simulated)).toBeVisible();

    await panel.getByRole("button", { name: copy.pause }).click();
    await expect(row.getByText(copy.states.paused)).toBeVisible();
    await panel.getByRole("button", { name: copy.resume }).click();
    await expect(row.getByText(copy.states.active)).toBeVisible();

    // Another member of the family reads it, and has no controls over it.
    await seatAs(page, "Ana");
    await page.goto("/dashboard/circle");
    await expect(panel.getByRole("listitem").filter({ hasText: fill(copy.perMonth, { amount: "$150.00" }) })).toBeVisible();
    await expect(panel.getByRole("button", { name: copy.pause })).toHaveCount(0);

    await seatAs(page, "Elena");
    await page.goto("/dashboard/circle");
    await panel.getByRole("button", { name: copy.cancel }).click();
    await expect(panel.getByText(copy.empty)).toBeVisible();
    await expect(panel.getByLabel(copy.amount)).toBeVisible();
  });

  test("refuses an amount outside the limits before asking the server", async ({ page }) => {
    const panel = await openCircle(page);
    for (const amount of ["0.50", "9999.00", "abc"]) {
      await panel.getByLabel(copy.amount).fill(amount);
      await panel.getByRole("button", { name: copy.start }).click();
      await expect(panel.getByRole("alert")).toHaveText(copy.errors.amount);
    }
    await expect(panel.getByText(copy.empty)).toBeVisible();
  });

  test("shows the caregiver and the observer no controls, and the caregiver none of it", async ({ page }) => {
    await startDemo(page);
    await seatAs(page, "Daniel");
    await page.goto("/dashboard/circle");
    const panel = page.getByRole("region", { name: copy.title });
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel(copy.amount)).toHaveCount(0);

    await seatAs(page, "Amara");
    await page.goto("/dashboard/circle");
    await expect(page.getByRole("region", { name: copy.title })).toHaveCount(0);
  });
});
