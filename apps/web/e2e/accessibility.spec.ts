import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { seatAs, startDemo } from "./support/demo";

// WCAG 2.2 level AA, the target in AGENTS.md section 8. Serious and critical
// findings fail the test; minor and moderate ones are listed in its output.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectAccessible(page: Page, name: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = violations.filter((each) => each.impact === "serious" || each.impact === "critical");
  const listed = violations.map((each) => `${each.impact ?? "?"} ${each.id}: ${each.help} (${each.nodes.length}× e.g. ${each.nodes[0]?.html.slice(0, 240) ?? ""})`);
  if (listed.length > 0) console.log(`${name}:\n  ${listed.join("\n  ")}`);
  expect(blocking.map((each) => `${each.id}: ${each.help}`), name).toEqual([]);
}

test("the public home page meets WCAG 2.2 AA", async ({ page }) => {
  await page.goto("/");
  await expectAccessible(page, "home");
});

test("the family's overview, the record and Ask Kin meet WCAG 2.2 AA", async ({ page }) => {
  await startDemo(page);
  await expectAccessible(page, "overview");
  await page.goto("/dashboard/record");
  await expectAccessible(page, "record");
  await page.goto("/dashboard/ask");
  await expectAccessible(page, "ask");
});

test("the parent's first screen meets WCAG 2.2 AA", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Rose");
  await expect(page).toHaveURL(/\/dashboard\/listen/);
  await expectAccessible(page, "listen");
});
