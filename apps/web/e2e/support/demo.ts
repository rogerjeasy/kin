import { expect, type Page } from "@playwright/test";

import english from "../../src/i18n/dictionaries/en.json" with { type: "json" };

/** Presses the Demo button on the home page, as a visitor with no account, and lands in the demo. */
export async function startDemo(page: Page): Promise<void> {
  await page.goto("/");
  // The hero's button: the closing band at the foot of the page has a second one.
  await page.getByRole("main").getByRole("button", { name: english.common.nav.demo }).first().click();
  await expect(page).toHaveURL("/dashboard");
}

/** Takes another persona's seat through the demo banner's role switcher. */
export async function seatAs(page: Page, name: string): Promise<void> {
  await page.getByRole("note").getByRole("button", { name: /^You are / }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole("note").getByRole("button", { name: new RegExp(`^You are ${name}`) })).toBeVisible();
}
