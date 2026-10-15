import { expect, type Locator, type Page } from "@playwright/test";

import english from "../../src/i18n/dictionaries/en.json" with { type: "json" };

/**
 * Opens the account menu and returns it. A click that lands before the page
 * has hydrated does nothing, so the click is tried again until the menu shows.
 */
export async function openAccountMenu(page: Page): Promise<Locator> {
  const trigger = page.getByRole("button", { name: new RegExp(english.dashboard.shell.account.menu) });
  const menu = page.getByRole("menu");
  await expect(async () => {
    await trigger.click();
    await expect(menu).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return menu;
}
