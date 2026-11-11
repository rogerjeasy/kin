import { expect, test, type Page } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { maybeScreenshot } from "./support/screenshot";
import { viewports } from "./support/viewports";

const copy = english.dashboard.shell.demo.guide;
const title = "Try it in 5 steps";
const steps = {
  topUp: english.dashboard.topUp.title,
  ask: "Ask Kin: “Reorder Rose's refill”",
  approve: "As Rose, approve Amara’s pay",
  listen: "Listen as Rose",
  verify: english.dashboard.verify.title,
};

const guide = (page: Page) => page.getByRole("region", { name: title });

/** On a phone the guide is one line until opened. */
async function openOnPhone(page: Page): Promise<void> {
  const toggle = guide(page).getByRole("button", { name: copy.show });
  if (await toggle.isVisible()) await toggle.click();
}

for (const viewport of viewports) {
  test(`the demo guide shows five steps with what is real behind each, and fits at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await expect(guide(page)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await openOnPhone(page);

    const items = guide(page).getByRole("listitem");
    await expect(items).toHaveCount(5);
    await expect(items.nth(0)).toContainText(steps.topUp);
    await expect(items.nth(0)).toContainText(copy.badges.sandbox);
    await expect(items.nth(1)).toContainText(steps.ask);
    await expect(items.nth(1)).toContainText(copy.badges.claude);
    // This deployment pays demo caregiver payouts as simulated, so the badge says so.
    await expect(items.nth(2)).toContainText(steps.approve);
    await expect(items.nth(2)).toContainText(copy.badges.simulated);
    await expect(items.nth(3)).toContainText(copy.badges.spoken);
    await expect(items.nth(4)).toContainText(copy.badges.provable);
    await expectNoHorizontalOverflow(page);
    await maybeScreenshot(page, "demo-guide");
  });
}

test("on a phone the guide stays one line until opened", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await startDemo(page);
  await expect(guide(page).getByRole("listitem").first()).toBeHidden();
  await guide(page).getByRole("button", { name: copy.show }).click();
  await expect(guide(page).getByRole("listitem").first()).toBeVisible();
  await guide(page).getByRole("button", { name: copy.hide }).click();
  await expect(guide(page).getByRole("listitem").first()).toBeHidden();
});

test("a step in Rose's seat takes her seat and opens its screen in one press", async ({ page }) => {
  await startDemo(page);
  await guide(page).getByRole("button", { name: new RegExp(steps.approve) }).click();
  await expect(page).toHaveURL(/\/dashboard\/approvals\?notice=roleChanged$/u);
  await expect(page.getByRole("note").getByRole("button", { name: /^You are Rose/u })).toBeVisible();

  // From her seat, the organizer's steps take Elena's seat back.
  await guide(page).getByRole("button", { name: new RegExp(steps.verify) }).click();
  await expect(page).toHaveURL(/\/dashboard\/record\/verify\?notice=roleChanged$/u);
  await expect(page.getByRole("note").getByRole("button", { name: /^You are Elena/u })).toBeVisible();
});

test("the ask step carries its question, and the top-up step opens the sheet", async ({ page }) => {
  await startDemo(page);
  await guide(page).getByRole("link", { name: new RegExp(steps.ask) }).click();
  await expect(page.getByLabel(english.askKin.form.label)).toHaveValue("Reorder Rose's refill");

  await guide(page).getByRole("link", { name: new RegExp(steps.topUp) }).click();
  await expect(page.getByRole("dialog", { name: english.dashboard.topUp.title })).toBeVisible();
});

test("a visitor can put the guide away, it stays away, and the banner brings it back", async ({ page }) => {
  await startDemo(page);
  await guide(page).getByRole("button", { name: copy.dismiss }).click();
  await expect(guide(page)).toHaveCount(0);
  await page.reload();
  await expect(guide(page)).toHaveCount(0);

  await page.goto("/dashboard/bills");
  await expect(guide(page)).toHaveCount(0);
  await page.getByRole("note").getByRole("button", { name: copy.reopen }).click();
  await expect(guide(page)).toBeVisible();
});
