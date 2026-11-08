import { expect, test } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { viewports } from "./support/viewports";

const copy = english.askKin;

for (const viewport of viewports) {
  test(`a visitor asks Kin from the overview and sees how Kin found the answer, at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    const card = page.getByRole("region", { name: copy.card.title });
    await expect(card).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await card.getByRole("link", { name: "Has Amara been paid?" }).click();
    await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
    await expect(page.getByLabel(copy.form.label)).toHaveValue("Has Amara been paid?");
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: copy.form.ask }).click();
    await expect(page.getByText("Kin read the record for you.")).toBeVisible();
    await expect(page.getByText(/^Written by Claude/)).toBeVisible();
    await expect(page.getByText(copy.answer.trace)).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: copy.tools.get_paypal_payout_status })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

test("a suggestion asks at once, and a reorder shows the proposal waiting for a yes", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Rose");
  await page.goto("/dashboard/ask");
  await page.getByRole("button", { name: "Reorder Rose's refill" }).click();
  await expect(page.getByText(copy.proposal.text)).toBeVisible();
  await expect(page.getByRole("link", { name: copy.proposal.link })).toHaveAttribute("href", "/dashboard/approvals");
  await expect(page.getByRole("listitem").filter({ hasText: copy.tools.propose_refill })).toBeVisible();
});

test("a caregiver can ask, and is offered only what concerns their own pay", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Amara");
  await page.goto("/dashboard/ask");
  await expect(page.getByRole("button", { name: copy.suggestions.owes })).toHaveCount(0);
  await page.getByLabel(copy.form.label).fill("Who owes whom this month?");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Kin cannot show that from your seat.")).toBeVisible();
  await expect(page.getByText(copy.answer.traceEmpty)).toBeVisible();
});
