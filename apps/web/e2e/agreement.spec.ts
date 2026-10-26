import { expect, test, type Page } from "@playwright/test";

import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { viewports } from "./support/viewports";

const AGREEMENT = "/dashboard/circle/agreement";

async function openAgreement(page: Page) {
  await page.goto(AGREEMENT);
  await expect(page.getByRole("heading", { level: 1, name: "Family agreement" })).toBeVisible();
}

for (const viewport of [...viewports, { name: "narrow", width: 320, height: 740 }]) {
  test(`the family agreement fits at ${viewport.width}×${viewport.height} (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await openAgreement(page);
    const terms = page.getByRole("region", { name: /^Version 1 · in force since/ });
    await expect(terms).toContainText("Marcus");
    await expect(terms).toContainText("If a month costs $1,000.00, Kin asks for $500.00 from Marcus, $300.00 from Elena, and $200.00 from Ana.");
    await expect(page.getByRole("region", { name: "What it means in practice" })).toContainText("A bill of $25.00");
    await expect(page.getByRole("region", { name: "Propose a change" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if (viewport.name === "phone" || viewport.name === "laptop") await page.screenshot({ path: `/private/tmp/kin-agreement-${viewport.name}.png`, fullPage: true });
  });
}

test("a change is reviewed, proposed, and governs once everyone who shares the cost accepts it", async ({ page }) => {
  await startDemo(page);
  await openAgreement(page);
  const form = page.getByRole("region", { name: "Propose a change" });
  await form.getByLabel("Marcus’s share (%)").fill("45");
  await form.getByLabel("Ana’s share (%)").fill("25");
  await form.getByLabel("A second yes above").fill("400.00");
  await expect(form.getByText("Total: 100%")).toBeVisible();
  await form.getByRole("button", { name: "Review the change" }).click();
  await expect(form).toContainText("Marcus’s share: 50% → 45%");
  await expect(form).toContainText("Ana’s share: 20% → 25%");
  await expect(form).toContainText("A second yes above: $500.00 → $400.00");
  await expectNoHorizontalOverflow(page);
  await form.getByRole("button", { name: "Propose version 2" }).click();
  await expect(form.getByRole("status").filter({ hasText: "Proposed." })).toBeVisible();

  const pending = page.getByRole("region", { name: "Version 2 is proposed" });
  await expect(pending).toContainText("Waiting for acceptance");
  await expect(pending).toContainText("You have accepted this version.");
  // Version 1 still governs until Marcus and Ana accept.
  await expect(page.getByRole("region", { name: /^Version 1 · in force since/ })).toBeVisible();

  for (const name of ["Marcus", "Ana"]) {
    await seatAs(page, name);
    await page.goto("/dashboard");
    await page.getByRole("link", { name: /Version 2 of the family agreement waits for your acceptance/ }).click();
    await page.getByRole("button", { name: "Accept version 2" }).click();
    await expect(page.getByText("You have accepted this version.").or(page.getByRole("region", { name: /^Version 2 · in force since/ })).first()).toBeVisible();
  }
  await expect(page.getByRole("region", { name: /^Version 2 · in force since/ })).toContainText("$450.00 from Marcus");
  await expect(page.getByRole("region", { name: "All versions" })).toContainText("Earlier version");
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /waits for your acceptance/ })).toHaveCount(0);
});

test("shares that do not add up to 100% are refused, and what was typed is kept", async ({ page }) => {
  await startDemo(page);
  await openAgreement(page);
  const form = page.getByRole("region", { name: "Propose a change" });
  await form.getByLabel("Marcus’s share (%)").fill("40");
  await form.getByRole("button", { name: "Review the change" }).click();
  await expect(form.getByRole("alert")).toHaveText("The shares must add up to exactly 100%.");
  await expect(form.getByLabel("Marcus’s share (%)")).toHaveValue("40");
});

test("only the organizer writes it, an observer only reads it, and a caregiver never sees it", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Daniel");
  await openAgreement(page);
  await expect(page.getByRole("region", { name: /^Version 1 · in force since/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Propose a change" })).toHaveCount(0);
  await seatAs(page, "Amara");
  await page.goto(AGREEMENT);
  await expect(page).toHaveURL("/dashboard/circle");
  await expect(page.getByRole("link", { name: "Open the agreement" })).toHaveCount(0);
});
