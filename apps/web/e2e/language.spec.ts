import { expect, test } from "@playwright/test";

import arabic from "../src/i18n/dictionaries/ar.json" with { type: "json" };
import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import french from "../src/i18n/dictionaries/fr.json" with { type: "json" };
import { localeNames, locales } from "../src/i18n/locales";
import { laptop } from "./support/viewports";

test.use({ viewport: { width: laptop.width, height: laptop.height } });

test("the site opens in English at the short address", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("choosing French keeps the visitor on the same page, in French", async ({ page }) => {
  await page.goto("/pricing");

  await page.getByRole("banner").getByRole("button", { name: english.common.language.label }).click();
  await page.getByRole("menuitem", { name: localeNames.fr }).click();

  await expect(page).toHaveURL("/fr/pricing");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(french.pricingPage.hero.title);
});

test("the language menu offers all seven languages by their own names", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("banner").getByRole("button", { name: english.common.language.label }).click();

  await expect(page.getByRole("menuitem")).toHaveText(locales.map((locale) => localeNames[locale]));
});

test("Arabic reads right to left", async ({ page }) => {
  await page.goto("/ar");

  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(arabic.home.hero.titleLead);
});

test("Hebrew reads right to left", async ({ page }) => {
  await page.goto("/he");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("links inside a translated page stay in that language", async ({ page }) => {
  await page.goto("/fr");

  await page.getByRole("banner").getByRole("link", { name: french.common.nav.safety, exact: true }).click();

  await expect(page).toHaveURL("/fr/safety");
});

test("switching back to English returns to the short address", async ({ page }) => {
  await page.goto("/fr/how-it-works");

  await page.getByRole("banner").getByRole("button", { name: french.common.language.label }).click();
  await page.getByRole("menuitem", { name: localeNames.en }).click();

  await expect(page).toHaveURL("/how-it-works");
});

test("an explicit English prefix redirects to the short address", async ({ page }) => {
  await page.goto("/en/pricing");

  await expect(page).toHaveURL("/pricing");
});

test("each page tells search engines where its translations live", async ({ page }) => {
  await page.goto("/pricing");

  for (const locale of locales) {
    const expected = locale === "en" ? "/pricing" : `/${locale}/pricing`;
    await expect(page.locator(`link[rel="alternate"][hreflang="${locale}"]`)).toHaveAttribute(
      "href",
      new RegExp(`${expected}$`),
    );
  }
});
