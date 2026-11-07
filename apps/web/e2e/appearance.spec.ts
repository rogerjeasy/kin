import { expect, test, type Page } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { expectReadableText } from "./support/expect-readable-text";
import { maybeScreenshot } from "./support/screenshot";

/** The screens added for the grand prize, each opened as the demo's organizer. */
const SCREENS = [
  { name: "office-line", path: "/dashboard/office-line" },
  { name: "record-check", path: "/dashboard/record/verify" },
  { name: "mandates", path: "/dashboard/circle/mandates" },
  { name: "fairness", path: "/dashboard/fairness" },
  { name: "simulator", path: "/dashboard/circle/agreement/simulate" },
] as const;

/** Text at 200 percent, as a reader who sets a large default font size gets it. */
async function zoomText(page: Page): Promise<void> {
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
}

test.describe("in dark mode", () => {
  test.use({ colorScheme: "dark", viewport: { width: 1024, height: 768 } });

  for (const screen of SCREENS) {
    test(`${screen.name} keeps its text readable`, async ({ page }) => {
      await startDemo(page);
      await page.goto(screen.path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await maybeScreenshot(page, `dark-${screen.name}`);
      await expectReadableText(page);
    });
  }
});

test.describe("in dark mode, after a call", () => {
  test.use({ colorScheme: "dark", viewport: { width: 1024, height: 768 } });

  test("the already-paid verdict and the family's alert stay readable", async ({ page }) => {
    const copy = english.dashboard.officeLine;
    await startDemo(page);
    await page.goto("/dashboard/office-line");
    await page.getByRole("button", { name: copy.scenarios.paid.label }).click();
    await page.getByRole("button", { name: copy.submit }).click();
    await expect(page.getByRole("status").filter({ hasText: copy.verdictTitle })).toContainText(copy.verdicts.already_paid);
    await maybeScreenshot(page, "dark-office-line-result");
    await expectReadableText(page);
  });
});

test.describe("in light mode", () => {
  test.use({ colorScheme: "light", viewport: { width: 1024, height: 768 } });

  for (const screen of SCREENS) {
    test(`${screen.name} keeps its text readable`, async ({ page }) => {
      await startDemo(page);
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectReadableText(page);
    });
  }
});

/** Browser zoom to 200 percent on a 1024 pixel window leaves the page 512 CSS pixels wide. */
test.describe("with the browser zoomed to 200 percent", () => {
  test.use({ viewport: { width: 512, height: 384 } });

  for (const screen of SCREENS) {
    test(`${screen.name} reflows and does not scroll sideways`, async ({ page }) => {
      await startDemo(page);
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await maybeScreenshot(page, `zoom-${screen.name}`);
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe("with only the text enlarged to 200 percent", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const screen of SCREENS) {
    test(`${screen.name} loses no content and does not scroll sideways`, async ({ page }) => {
      await startDemo(page);
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await zoomText(page);
      await maybeScreenshot(page, `text-${screen.name}`);
      await expectNoHorizontalOverflow(page);
    });
  }
});
