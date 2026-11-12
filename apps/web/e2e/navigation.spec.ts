import { expect, test } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { laptop, phone } from "./support/viewports";

const { nav } = english.common;

const destinations = [
  { link: nav.howItWorks, path: "/how-it-works", heading: english.howItWorks.hero.title },
  { link: nav.safety, path: "/safety", heading: english.safetyPage.hero.title },
  { link: nav.caregivers, path: "/caregivers", heading: english.caregiversPage.hero.title },
  { link: nav.pricing, path: "/pricing", heading: english.pricingPage.hero.title },
  { link: nav.signIn, path: "/sign-in", heading: english.signInPage.hero.title },
  { link: nav.start, path: "/start", heading: english.startPage.hero.title },
];

test.describe("on a laptop", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });

  for (const destination of destinations) {
    test(`the header's "${destination.link}" link opens ${destination.path}`, async ({ page }) => {
      await page.goto("/");

      await page.getByRole("banner").getByRole("link", { name: destination.link, exact: true }).click();

      await expect(page).toHaveURL(destination.path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(destination.heading);
    });
  }

  test("the header marks the page you are on", async ({ page }) => {
    await page.goto("/safety");

    const current = page.getByRole("banner").getByRole("link", { name: nav.safety, exact: true });
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("banner").getByRole("link", { name: nav.pricing, exact: true }),
    ).not.toHaveAttribute("aria-current", "page");
  });

  test("pages load without errors in the browser console", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    for (const path of ["/", "/safety", "/fr/pricing", "/ar"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }

    expect(errors).toEqual([]);
  });

  test("the logo leads back to the homepage", async ({ page }) => {
    await page.goto("/pricing");

    await page.getByRole("banner").getByRole("link", { name: english.common.brandHome }).click();

    await expect(page).toHaveURL("/");
  });

  test("the hero's main button is the demo, and its second button opens the start page", async ({ page }) => {
    await page.goto("/");
    const hero = page.getByRole("main").locator("section").first();

    await expect(hero.getByRole("button", { name: nav.demo })).toHaveAttribute("data-variant", "inverse");
    const start = hero.getByRole("link", { name: nav.startLong });
    await expect(start).toHaveAttribute("data-variant", "outline");
    await start.click();

    await expect(page).toHaveURL("/start");
  });

  test("the header's filled button is the demo", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("banner").getByRole("button", { name: nav.demo })).toHaveAttribute("data-variant", "default");
  });

  for (const path of ["/", "/how-it-works", "/safety", "/caregivers", "/pricing"]) {
    test(`the closing band on ${path} leads with the demo and keeps a way to start`, async ({ page }) => {
      await page.goto(path);
      const closing = page.getByRole("region", { name: english.home.closing.title });

      await expect(closing.getByRole("button", { name: nav.demo })).toHaveAttribute("data-variant", "inverse");
      await expect(closing.getByRole("link", { name: nav.startLong })).toHaveAttribute("href", "/start");
    });
  }

  test("the footer links to every page", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByRole("contentinfo");

    for (const destination of destinations.slice(0, 5)) {
      await expect(footer.getByRole("link", { name: destination.link, exact: true })).toHaveAttribute(
        "href",
        destination.path,
      );
    }
  });

  test("each page has one main heading and one main region", async ({ page }) => {
    for (const path of ["/", ...destinations.map((destination) => destination.path)]) {
      await page.goto(path);

      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
    }
  });

  test("the first Tab stop skips to the content", async ({ page }) => {
    await page.goto("/");

    await page.keyboard.press("Tab");

    const skip = page.getByRole("link", { name: english.common.skipToContent });
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute("href", "#content");
  });

  test("an address that does not exist answers 404 with a way home", async ({ page }) => {
    const response = await page.goto("/no-such-page");

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(english.notFound.title);
    await expect(page.getByRole("link", { name: english.notFound.link })).toHaveAttribute("href", "/");
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: phone.width, height: phone.height } });

  test("the menu button opens the links and a link closes it again", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("banner").getByRole("link", { name: nav.pricing, exact: true }),
    ).toBeHidden();

    await page.getByRole("button", { name: nav.menuOpen }).click();
    const menu = page.getByRole("dialog", { name: nav.menuTitle });
    await menu.getByRole("link", { name: nav.pricing, exact: true }).click();

    await expect(page).toHaveURL("/pricing");
    await expect(menu).toBeHidden();
  });

  test("the menu closes with Escape and returns focus to its button", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: nav.menuOpen });

    await button.click();
    await expect(page.getByRole("dialog", { name: nav.menuTitle })).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog", { name: nav.menuTitle })).toBeHidden();
    await expect(button).toBeFocused();
  });
});
