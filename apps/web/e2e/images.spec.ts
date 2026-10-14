import { expect, test } from "@playwright/test";

import { phone } from "./support/viewports";

test.use({ viewport: { width: phone.width, height: phone.height } });

for (const path of ["/", "/caregivers", "/how-it-works"]) {
  test(`every photograph on ${path} loads`, async ({ page, request }) => {
    await page.goto(path);

    const images = page.locator("img");
    const count = await images.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const image = images.nth(index);
      // Photographs below the fold only load once they are scrolled to.
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
        .toBeGreaterThan(0);
    }

    // The ring draws its portraits inside the SVG, where naturalWidth does not exist.
    const ringPortraits = await page.locator("svg image").evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("href") ?? ""),
    );
    for (const href of ringPortraits) {
      expect((await request.get(href)).ok(), `${href} must load`).toBe(true);
    }
  });
}
