import { readFileSync } from "node:fs";

import { expect, test, type Route } from "@playwright/test";

import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { viewports } from "./support/viewports";

const SPOKEN = readFileSync(new URL("./fixtures/spoken.mp3", import.meta.url));

for (const viewport of viewports) {
  test(`the parent reads and hears what Kin confirmed, and picks how often, at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const said: string[] = [];
    await page.route("**/api/speech/say", async (route: Route) => {
      said.push(route.request().postData() ?? "");
      await route.fulfill({ body: SPOKEN, contentType: "audio/mpeg" });
    });
    await startDemo(page);
    await seatAs(page, "Rose");
    await page.goto("/dashboard/listen");
    await expect(page.getByRole("heading", { level: 1, name: "What Kin tells you" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // As it happens: one sentence, with the amount from the record.
    const sentences = page.getByRole("main").getByRole("listitem").filter({ hasText: /\$/ });
    await expect(sentences).toHaveCount(1);

    await page.getByRole("link", { name: "Once a week" }).click();
    await expect(page.getByRole("link", { name: "Once a week" })).toHaveAttribute("aria-current", "page");
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "Hear it" }).click();
    await expect.poll(() => said.length).toBe(1);
    expect(JSON.parse(said[0] ?? "{}")).toEqual({ kind: "announcement", every: "week", locale: "en" });
  });
}

test("a caregiver cannot open the parent's screen", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Amara");
  await page.goto("/dashboard/listen");
  await expect(page).not.toHaveURL(/\/dashboard\/listen/);
});
