import { expect, test, type Page } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { maybeScreenshot } from "./support/screenshot";
import { laptop, viewports } from "./support/viewports";

const { studio } = english.dashboard;
const PATH = "/dashboard/record/studio";

/** The frame the page decides in: Kin's summary, or AG Studio once the frame is wide enough. */
const surface = (page: Page) => page.locator("[data-studio-phase]");

async function settled(page: Page): Promise<string> {
  await expect(surface(page)).not.toHaveAttribute("data-studio-phase", "deciding", { timeout: 30_000 });
  return (await surface(page).getAttribute("data-studio-phase")) ?? "";
}

for (const viewport of viewports) {
  test.describe(`at ${viewport.width}×${viewport.height} (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("the family money studio fits: AG Studio on a wide screen, Kin's summary on a phone", async ({ page }) => {
      await startDemo(page);
      await page.goto(PATH);
      await expect(page.getByRole("heading", { level: 1, name: studio.title })).toBeVisible();
      const phase = await settled(page);
      if (viewport.width < 640) {
        expect(phase).toBe("narrow");
        await expect(page.getByText(studio.notes.narrow)).toBeVisible();
        await expect(page.getByRole("heading", { name: studio.summary.title })).toBeVisible();
      } else if (viewport.width >= 1024) {
        expect(phase).toBe("studio");
      }
      if (phase === "studio") {
        // Kin's two widgets, drawn inside AG Studio from the record's own rows.
        await expect(page.getByText(studio.widgets.verified.count)).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(studio.widgets.verified.none)).toBeVisible();
        await expect(page.getByRole("list", { name: studio.widgets.fairnessGap.title })).toBeVisible();
      }
      await maybeScreenshot(page, "studio");
      await expectNoHorizontalOverflow(page);
    });
  });
}

test.describe("the studio on a laptop", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });

  test("opens from the Record, and shows each share given against agreed in Kin's words", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record");
    await page.getByRole("link", { name: studio.link }).click();
    await expect(page).toHaveURL(PATH);
    expect(await settled(page)).toBe("studio");
    const shares = page.getByRole("list", { name: studio.widgets.fairnessGap.title });
    await expect(shares.getByRole("listitem")).not.toHaveCount(0);
    // Every figure is written by Kin's money formatter, never as raw cents.
    await expect(shares).toContainText("$");
  });

  test("lets an observer look, but not build", async ({ page }) => {
    await startDemo(page);
    await seatAs(page, "Daniel");
    await page.goto(PATH);
    await expect(page.getByText(studio.readOnly)).toBeVisible();
    expect(await settled(page)).toBe("studio");
  });

  test("is not a caregiver's screen, as the Record is not", async ({ page }) => {
    await startDemo(page);
    await seatAs(page, "Amara");
    await page.goto(PATH);
    await expect(page).not.toHaveURL(PATH);
  });
});
