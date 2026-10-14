import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { viewports } from "./support/viewports";

// Every page in English, plus a long-worded language and both right-to-left ones.
const paths = [
  "/",
  "/how-it-works",
  "/safety",
  "/caregivers",
  "/pricing",
  "/start",
  "/sign-in",
  "/de",
  "/de/pricing",
  "/de/how-it-works",
  "/de/start",
  "/fr/how-it-works",
  "/fr/start",
  "/it/safety",
  "/es/caregivers",
  "/ar",
  "/ar/how-it-works",
  "/ar/safety",
  "/ar/sign-in",
  "/he",
  "/he/pricing",
  "/he/caregivers",
];

for (const viewport of viewports) {
  test.describe(`at ${viewport.width}×${viewport.height} (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const path of paths) {
      test(`${path} fits the screen`, async ({ page }) => {
        await page.goto(path);

        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow(page);
      });
    }
  });
}
