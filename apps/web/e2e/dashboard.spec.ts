import { expect, test, type Page } from "@playwright/test";

import { dashboardNav, dashboardRoutes } from "../src/content/dashboard-routes";
import arabic from "../src/i18n/dictionaries/ar.json" with { type: "json" };
import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { fill } from "../src/i18n/template";
import { openAccountMenu } from "./support/account-menu";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { IDENTITY_PROVIDER } from "./support/identity-provider";
import { laptop, phone, viewports } from "./support/viewports";

const { dashboard } = english;
const paths = dashboardNav.map((section) => dashboardRoutes[section]);

/** Records every request that is not a page or asset load. */
function watchWrites(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") sent.push(`${request.method()} ${request.url()}`);
  });
  return sent;
}

for (const viewport of viewports) {
  test.describe(`at ${viewport.width}×${viewport.height} (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const path of [...paths, "/ar/dashboard", "/de/dashboard/approvals", "/he/dashboard/record"]) {
      test(`${path} fits the screen`, async ({ page }) => {
        await page.goto(path);

        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow(page);
      });
    }
  });
}

test.describe("on a laptop", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });

  test("every screen says it is a demonstration, and asks search engines not to list it", async ({ page }) => {
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole("note").filter({ hasText: dashboard.shell.demo.text })).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    }
  });

  test("the sidebar leads to each screen and marks the one that is open", async ({ page }) => {
    await page.goto("/dashboard");
    const sidebar = page.getByRole("complementary").getByRole("navigation", { name: dashboard.shell.navLabel });

    for (const section of dashboardNav) {
      await sidebar.getByRole("link", { name: dashboard.shell.nav[section] }).click();
      await expect(page).toHaveURL(dashboardRoutes[section]);
      await expect(sidebar.getByRole("link", { name: dashboard.shell.nav[section] })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });

  test("the overview leads with the pool's confirmed balance and the month's figures", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fill(dashboard.overview.greeting, { name: IDENTITY_PROVIDER.person.name }));
    const stats = page.getByRole("definition");
    await expect(stats.filter({ hasText: "$382.18" })).toBeVisible();
    await expect(stats.filter({ hasText: "$924.00" })).toBeVisible();
    await expect(page.getByRole("region", { name: dashboard.overview.safety.title })).toContainText("$300.00");
  });

  test("approving answers that nothing moved, and sends nothing", async ({ page }) => {
    const sent = watchWrites(page);
    await page.goto("/dashboard/approvals");
    const stairlift = page.getByRole("article", { name: dashboard.approvals.purposes.stairlift.title });

    await expect(stairlift).toContainText("Rose said yes by phone");
    await stairlift.getByRole("button", { name: dashboard.common.approve }).click();

    await expect(stairlift.getByRole("status")).toContainText(dashboard.demoAction.title);
    expect(sent).toEqual([]);
  });

  test("a proposal that waits for Rose offers Elena no button to answer it", async ({ page }) => {
    await page.goto("/dashboard/approvals");
    const amara = page.getByRole("article", { name: dashboard.approvals.purposes.caregiverWeek.title });

    await expect(amara).toContainText(dashboard.approvals.slots.parentCall);
    await expect(amara.getByRole("button", { name: dashboard.common.approve })).toHaveCount(0);
  });

  test("the pause switch asks again, then answers that nothing moved", async ({ page }) => {
    const sent = watchWrites(page);
    await page.goto("/dashboard");

    await page.getByRole("complementary").getByRole("button", { name: dashboard.pause.button }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText(fill(dashboard.pause.title, { hours: "24" }));
    await sheet.getByRole("button", { name: fill(dashboard.pause.confirm, { hours: "24" }) }).click();

    await expect(sheet.getByRole("status")).toContainText(dashboard.demoAction.title);
    expect(sent).toEqual([]);
  });

  test("the record is a grid that filters by kind and shows the selected entry's balanced lines", async ({ page }) => {
    await page.goto("/dashboard/record");
    const grid = page.getByRole("region", { name: dashboard.record.grid.label });
    const rows = grid.locator(".ag-row");
    await expect(rows).toHaveCount(19);

    await page.getByRole("button", { name: dashboard.record.filters.care }).click();
    await expect(page.getByRole("button", { name: dashboard.record.filters.care })).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(4);

    await rows.first().click();
    const detail = page.getByRole("region", { name: dashboard.record.grid.detailTitle });
    await expect(detail.getByRole("table")).toContainText(dashboard.record.accounts.care_received);
    await expect(detail.getByRole("table")).toContainText("$20.00");
  });

  test("the record grid can be read row by row with the keyboard", async ({ page }) => {
    await page.goto("/dashboard/record");
    const grid = page.getByRole("region", { name: dashboard.record.grid.label });
    const detail = page.getByRole("region", { name: dashboard.record.grid.detailTitle });

    await grid.locator(".ag-row").first().locator("[role='gridcell']").first().click();
    const first = await detail.locator("p").first().textContent();
    await page.keyboard.press("ArrowDown");
    await expect(detail.locator("p").first()).not.toHaveText(first ?? "");
  });

  test("the fairness screen shows the settlement the money core planned", async ({ page }) => {
    await page.goto("/dashboard/fairness");
    const settlement = page.getByRole("region", { name: dashboard.fairness.settlement.title });

    await expect(settlement).toContainText(fill(dashboard.fairness.settlement.payout, { name: "Elena" }));
    await expect(settlement).toContainText("$126.00");
    await expect(settlement).toContainText(fill(dashboard.fairness.settlement.collection, { name: "Marcus" }));
    await expect(settlement).toContainText("$166.00");
  });

  test("the circle's screens read right to left in Arabic", async ({ page }) => {
    await page.goto("/ar/dashboard/fairness");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(arabic.dashboard.fairness.title);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: phone.width, height: phone.height } });

  test("the sections sit along the bottom, and the circle is in the account menu", async ({ page }) => {
    await page.goto("/dashboard");
    const bar = page.getByRole("navigation", { name: dashboard.shell.navLabel });

    await expect(page.getByRole("complementary")).toBeHidden();
    await bar.getByRole("link", { name: dashboard.shell.nav.approvals }).click();
    await expect(page).toHaveURL("/dashboard/approvals");
    await expect(bar.getByRole("link", { name: dashboard.shell.nav.approvals })).toHaveAttribute("aria-current", "page");

    const menu = await openAccountMenu(page);
    await menu.getByRole("menuitem", { name: dashboard.shell.account.settings }).click();
    await expect(page).toHaveURL("/dashboard/circle");
  });

  test("the record shows the entries as cards that open to their lines", async ({ page }) => {
    await page.goto("/dashboard/record");

    await expect(page.getByRole("region", { name: dashboard.record.grid.label })).toBeHidden();
    await page.getByRole("button", { name: dashboard.record.filters.care }).click();
    const cards = page.locator("details");
    await expect(cards).toHaveCount(4);
    await cards.first().locator("summary").click();
    await expect(cards.first().getByRole("table")).toContainText(dashboard.record.accounts.care_received);
  });

  test("the last card on a screen is never hidden under the bottom bar", async ({ page }) => {
    await page.goto("/dashboard/approvals");
    await page.mouse.wheel(0, 20_000);

    const bar = await page.getByRole("navigation", { name: dashboard.shell.navLabel }).boundingBox();
    const lastCard = await page.locator("main section").last().boundingBox();
    expect(bar).not.toBeNull();
    expect(lastCard).not.toBeNull();
    if (bar && lastCard) expect(lastCard.y + lastCard.height).toBeLessThanOrEqual(bar.y);
  });
});
