import { expect, test } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { laptop } from "./support/viewports";

const { theme } = english.common;

test.use({ viewport: { width: laptop.width, height: laptop.height } });

test.describe("when the device prefers light", () => {
  test.use({ colorScheme: "light" });

  test("the site opens light", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("the header button switches to dark, and the choice survives a reload and a new page", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("banner").getByRole("button", { name: theme.switchToDark }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.goto("/pricing");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("banner").getByRole("button", { name: theme.switchToLight })).toBeVisible();
  });

  test("the page background actually changes colour", async ({ page }) => {
    await page.goto("/");
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await background();

    await page.getByRole("banner").getByRole("button", { name: theme.switchToDark }).click();

    await expect.poll(background).not.toBe(light);
  });
});

test.describe("when the device prefers dark", () => {
  test.use({ colorScheme: "dark" });

  test("the site opens dark", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("choosing Light in the footer overrides the device, and System hands control back", async ({
    page,
  }) => {
    await page.goto("/");
    const choices = page.getByRole("contentinfo").getByRole("radiogroup", { name: theme.label });

    await choices.getByRole("radio", { name: theme.light }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await choices.getByRole("radio", { name: theme.system }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
