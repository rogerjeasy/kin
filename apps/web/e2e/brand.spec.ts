import { expect, test } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { laptop } from "./support/viewports";

const { brandHome, theme } = english.common;

test.use({ viewport: { width: laptop.width, height: laptop.height }, colorScheme: "light" });

for (const landmark of ["banner", "contentinfo"] as const) {
  test(`the logo in the ${landmark} draws the knot as three strands around a centre`, async ({ page }) => {
    await page.goto("/");

    const mark = page.getByRole(landmark).getByRole("link", { name: brandHome }).locator("svg");

    await expect(mark).toBeVisible();
    await expect(mark.locator("path")).toHaveCount(3);
    await expect(mark.locator("circle")).toHaveCount(1);
  });
}

test("the knot changes colour with the theme, so it stays legible in the dark", async ({ page }) => {
  await page.goto("/");
  const strand = page.getByRole("banner").getByRole("link", { name: brandHome }).locator("svg path").first();
  const colour = () => strand.evaluate((element) => getComputedStyle(element).stroke);
  const light = await colour();

  await page.getByRole("banner").getByRole("button", { name: theme.switchToDark }).click();

  await expect.poll(colour).not.toBe(light);
});

test("the site icon is the knot, served as an SVG image", async ({ page, request }) => {
  await page.goto("/");

  const href = await page.locator('link[rel="icon"]').getAttribute("href");
  const response = await request.get(href ?? "");

  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
  expect((await response.text()).match(/<path /g)).toHaveLength(3);
});
