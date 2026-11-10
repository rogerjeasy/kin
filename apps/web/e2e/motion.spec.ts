import { expect, test, type Page } from "@playwright/test";

import { startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { expectReadableText } from "./support/expect-readable-text";
import { laptop, phone, viewports } from "./support/viewports";

/**
 * The rest of the suite runs with reduced motion (playwright.config.ts). These
 * tests let the page move: every entrance must end with the screen fitting its
 * viewport and every word readable, and the hero's knot must draw.
 */
test.use({ reducedMotion: "no-preference" });
// One at a time: a moving page is painted in software by headless Chromium, and
// several at once starve the app server that the other tests are waiting on.
test.describe.configure({ mode: "serial" });

/** Waits for every entrance that runs once. Endless glows and scroll-linked rises never finish, so they are left out. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const entrances = document
      .getAnimations()
      .filter((animation) => animation.timeline === document.timeline && animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(entrances.map((animation) => animation.finished.catch(() => undefined)));
  });
}

for (const viewport of viewports) {
  test(`the home page settles to fit and read at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await settle(page);
    await expectNoHorizontalOverflow(page);
    await expectReadableText(page);
  });
}

test("the hero shows Rose inside the knot, drawn in 3D only on a graphics processor", async ({ page }) => {
  await page.setViewportSize({ width: laptop.width, height: laptop.height });
  await page.goto("/");
  const hero = page.locator("section").first();
  // The still poster always paints first, so the hero is never empty.
  const poster = hero.locator("img").first();
  await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  // Headless Chromium draws WebGL in software (SwiftShader), where a moving
  // scene would take the page's time, so the scene must not start here.
  await page.waitForTimeout(3000);
  await expect(hero.locator("canvas")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("with reduced motion the hero keeps its still poster and draws no 3D", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: phone.width, height: phone.height });
  await page.goto("/");
  const running = await page.evaluate(
    () => document.getAnimations().filter((animation) => animation.playState === "running" && Number(animation.effect?.getComputedTiming().duration ?? 0) > 1).length,
  );
  expect(running).toBe(0);
  const hero = page.locator("section").first();
  await expect(hero.locator("img").first()).toBeVisible();
  // Long enough for the idle start the scene waits for.
  await page.waitForTimeout(3000);
  await expect(hero.locator("canvas")).toHaveCount(0);
});

for (const viewport of [phone, laptop]) {
  test(`the demo overview settles to fit and read at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await settle(page);
    await expectNoHorizontalOverflow(page);
    await expectReadableText(page);
  });
}
