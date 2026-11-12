import { expect, test, type Locator } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { fill } from "../src/i18n/template";
import { startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { maybeScreenshot } from "./support/screenshot";
import { viewports } from "./support/viewports";

const { overview } = english.dashboard;
const parent = { parent: "Rose" };

async function top(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("The region is not on screen");
  return box.y;
}

for (const viewport of viewports) {
  test(`the overview tells the money story first and gathers Kin's helpers below it, at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    const protects = page.getByRole("region", { name: fill(overview.protects.title, parent) });
    await expect(protects).toBeVisible();

    // Every helper is still there, as a tile in the one section.
    const tiles = [
      overview.safety.title,
      english.dashboard.presence.link.title,
      fill(english.dashboard.purse.card.title, parent),
      fill(english.dashboard.wishes.link.title, parent),
      english.dashboard.quietShares.card.title,
      english.openKin.card.title,
    ];
    for (const tile of tiles) await expect(protects.getByRole("region", { name: tile })).toBeVisible();

    // The money comes first: what waits, what Rose heard, fairness and the record all sit above the helpers.
    const helpersTop = await top(protects);
    for (const name of [overview.attention.title, fill(overview.heard.title, parent), overview.activity.title]) {
      expect(await top(page.getByRole("region", { name }))).toBeLessThan(helpersTop);
    }
    expect(await top(page.getByRole("region", { name: /^Fairness in / }))).toBeLessThan(helpersTop);
    await expectNoHorizontalOverflow(page);
    await maybeScreenshot(page, "overview");
  });
}
