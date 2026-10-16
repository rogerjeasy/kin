import { expect, test } from "@playwright/test";

import { dashboardNav, dashboardRoutes } from "../src/content/dashboard-routes";
import arabic from "../src/i18n/dictionaries/ar.json" with { type: "json" };
import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { fill } from "../src/i18n/template";
import { openAccountMenu } from "./support/account-menu";
import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { laptop, phone, viewports } from "./support/viewports";

const { dashboard } = english;
const paths = dashboardNav.map((section) => dashboardRoutes[section]);

// Each test opens a fresh browser, so each is a new visitor with their own
// copy of Rose's circle: nothing one test does reaches another.

for (const viewport of viewports) {
  test.describe(`the demo at ${viewport.width}×${viewport.height} (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("every screen fits, in every direction of reading", async ({ page }) => {
      await startDemo(page);
      for (const path of [...paths, "/ar/dashboard", "/de/dashboard/approvals", "/he/dashboard/record"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }
    });
  });
}

test.describe("the Demo button", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });

  test("opens Rose's circle with no account, as Elena the organizer", async ({ page }) => {
    await startDemo(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fill(dashboard.overview.greeting, { name: "Elena" }));
    await expect(page.getByRole("note").getByRole("button", { name: /^You are Elena/ })).toBeVisible();
    const stats = page.getByRole("definition");
    await expect(stats.filter({ hasText: "$382.18" })).toBeVisible();
    await expect(stats.filter({ hasText: "$924.00" })).toBeVisible();
    expect((await page.context().cookies()).map((cookie) => cookie.name)).toContain("__Host-kin-demo");
  });

  test("keeps the visitor's session out of reach of page scripts", async ({ page }) => {
    await startDemo(page);
    const demo = (await page.context().cookies()).find((cookie) => cookie.name === "__Host-kin-demo");
    expect(demo).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    expect(await page.evaluate(() => document.cookie)).toBe("");
  });

  test("says on every screen that it is a demonstration, and asks search engines not to list it", async ({ page }) => {
    await startDemo(page);
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole("note").filter({ hasText: dashboard.shell.demo.label })).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    }
  });

  test("leads through the sidebar to each screen and marks the one that is open", async ({ page }) => {
    await startDemo(page);
    const sidebar = page.getByRole("complementary").getByRole("navigation", { name: dashboard.shell.navLabel });
    for (const section of dashboardNav) {
      await sidebar.getByRole("link", { name: dashboard.shell.nav[section] }).click();
      await expect(page).toHaveURL(dashboardRoutes[section]);
      await expect(sidebar.getByRole("link", { name: dashboard.shell.nav[section] })).toHaveAttribute("aria-current", "page");
    }
  });

  test("a demo cookie changed to name another visitor opens nothing", async ({ page }) => {
    await startDemo(page);
    const demo = (await page.context().cookies()).find((cookie) => cookie.name === "__Host-kin-demo");
    expect(demo).toBeDefined();
    if (!demo) return;
    const [, signature] = demo.value.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, sub: "demo:someone-else", exp: Date.now() + 86_400_000 })).toString("base64url");
    await page.context().clearCookies();
    await page.context().addCookies([{ ...demo, value: `${forged}.${signature}` }]);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard$/);
  });
});

test.describe("every role of the demo", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });

  test("Amara, the caregiver, sees only her own pay and the screens it is on", async ({ page }) => {
    await startDemo(page);
    await seatAs(page, "Amara");
    await expect(page).toHaveURL(/\/dashboard\/approvals\?notice=roleChanged$/);
    const sidebar = page.getByRole("complementary").getByRole("navigation", { name: dashboard.shell.navLabel });
    // A link carries its waiting count after its name.
    await expect(sidebar.getByRole("link")).toHaveText([new RegExp(`^${dashboard.shell.nav.approvals}`), dashboard.shell.nav.bills, dashboard.shell.nav.circle]);
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("article")).toContainText(dashboard.approvals.purposes.caregiverWeek.title);
    await page.goto("/dashboard/record");
    await expect(page).toHaveURL("/dashboard/approvals");
  });

  test("Daniel, the observer, reads everything and can neither answer nor pause", async ({ page }) => {
    await startDemo(page);
    await seatAs(page, "Daniel");
    await page.goto("/dashboard/approvals");
    await expect(page.getByRole("button", { name: dashboard.common.approve })).toHaveCount(0);
    await expect(page.getByRole("button", { name: dashboard.pause.button })).toHaveCount(0);
    await page.goto("/dashboard/record");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(dashboard.record.title);
  });

  test("Marcus's yes approves the stairlift repair, beside Rose's spoken yes", async ({ page }) => {
    await startDemo(page);
    await seatAs(page, "Marcus");
    await page.goto("/dashboard/approvals");
    const stairlift = page.getByRole("article", { name: dashboard.approvals.purposes.stairlift.title });
    await expect(stairlift).toContainText("Rose said yes by phone");
    await stairlift.getByRole("button", { name: dashboard.common.approve }).click();

    await expect(page).toHaveURL("/dashboard/approvals?notice=approved");
    await expect(page.getByRole("status").filter({ hasText: dashboard.notices.approved })).toBeVisible();
    const answered = page.getByRole("region", { name: dashboard.approvals.answered.title });
    await expect(answered).toContainText(dashboard.approvals.purposes.stairlift.title);
    await expect(answered).toContainText("Marcus said yes in the app");
    await expect(page.getByRole("article", { name: dashboard.approvals.purposes.stairlift.title })).toHaveCount(0);
  });

  test("Rose's no declines Amara's week, and nothing is paid", async ({ page }) => {
    await startDemo(page);
    await seatAs(page, "Rose");
    await page.goto("/dashboard/approvals");
    const week = page.getByRole("article", { name: dashboard.approvals.purposes.caregiverWeek.title });
    await week.getByRole("button", { name: dashboard.common.decline }).click();
    await expect(page.getByRole("status").filter({ hasText: dashboard.notices.rejected })).toBeVisible();
    await expect(page.getByRole("region", { name: dashboard.approvals.answered.title })).toContainText(dashboard.approvals.answered.states.rejected);
  });

  test("a proposal that waits for Rose offers Elena no button to answer it", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/approvals");
    const amara = page.getByRole("article", { name: dashboard.approvals.purposes.caregiverWeek.title });
    await expect(amara).toContainText(fill(dashboard.approvals.slots.parentCall, { parent: "Rose" }));
    await expect(amara.getByRole("button", { name: dashboard.common.approve })).toHaveCount(0);
  });
});

test.describe("the pause switch in the demo", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });

  test("asks again, holds every proposal, and the organizer can lift it", async ({ page }) => {
    await startDemo(page);
    await page.getByRole("complementary").getByRole("button", { name: dashboard.pause.button }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText(fill(dashboard.pause.title, { hours: "24" }));
    await sheet.getByRole("button", { name: fill(dashboard.pause.confirm, { hours: "24" }) }).click();

    await expect(page.getByRole("status").filter({ hasText: dashboard.notices.paused })).toBeVisible();
    await page.goto("/dashboard/approvals");
    await expect(page.getByRole("article").first()).toContainText(dashboard.common.planLabels.paused);

    await page.getByRole("complementary").getByRole("button", { name: dashboard.pause.resume }).click();
    await page.getByRole("dialog").getByRole("button", { name: dashboard.pause.resume }).click();
    await expect(page.getByRole("status").filter({ hasText: dashboard.notices.resumed })).toBeVisible();
    await expect(page.getByRole("complementary").getByRole("button", { name: dashboard.pause.button })).toBeVisible();
  });
});

test.describe("the circle and its record in the demo", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });

  test("an organizer's invitation is recorded and listed as waiting", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/circle");
    await page.getByRole("main").getByRole("button", { name: dashboard.circle.members.invite }).click();
    await page.getByLabel(dashboard.circle.invite.email).fill("grace@example.com");
    await page.getByLabel(dashboard.circle.invite.role).selectOption("observer");
    await page.getByRole("button", { name: dashboard.circle.invite.submit }).click();

    await expect(page.getByRole("status").filter({ hasText: dashboard.notices.invited })).toBeVisible();
    const invitations = page.getByRole("region", { name: dashboard.circle.invitations.title });
    await expect(invitations).toContainText("grace@example.com");
    await expect(invitations).toContainText(dashboard.circle.invitations.status.pending);
  });

  test("the record downloads as a CSV, every line marked simulated", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: dashboard.record.download }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("kin-record-2026-10.csv");
    const response = await page.request.get("/en/dashboard/record/export");
    const lines = (await response.text()).trim().split("\r\n");
    expect(lines[0]).toBe("Date,Entry,Kind,Account,Debit,Credit,Simulated");
    expect(lines.slice(1).every((line) => line.endsWith(",yes"))).toBe(true);
    expect(lines).toContain("2026-10-01,Marcus’s contribution,Contribution,Pool cash,409.13,,yes");
  });

  test("the record is a grid that filters by kind and shows the selected entry's balanced lines", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record");
    const grid = page.getByRole("region", { name: dashboard.record.grid.label });
    const rows = grid.locator(".ag-row");
    await expect(rows).toHaveCount(19);
    await page.getByRole("button", { name: dashboard.record.filters.care }).click();
    await expect(rows).toHaveCount(4);
    await rows.first().click();
    const detail = page.getByRole("region", { name: dashboard.record.grid.detailTitle });
    await expect(detail.getByRole("table")).toContainText(dashboard.record.accounts.care_received);
  });

  test("the record grid can be read row by row with the keyboard", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record");
    const grid = page.getByRole("region", { name: dashboard.record.grid.label });
    const detail = page.getByRole("region", { name: dashboard.record.grid.detailTitle });
    await grid.locator(".ag-row").first().locator("[role='gridcell']").first().click();
    const first = await detail.locator("p").first().textContent();
    await page.keyboard.press("ArrowDown");
    await expect(detail.locator("p").first()).not.toHaveText(first ?? "");
  });

  test("the fairness screen shows the settlement the money core planned", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/fairness");
    const settlement = page.getByRole("region", { name: fill(dashboard.fairness.settlement.title, { month: "October 2026" }) });
    await expect(settlement).toContainText(fill(dashboard.fairness.settlement.payout, { name: "Elena" }));
    await expect(settlement).toContainText("$126.00");
    await expect(settlement).toContainText("$166.00");
  });

  test("reads right to left in Arabic", async ({ page }) => {
    await startDemo(page);
    await page.goto("/ar/dashboard/fairness");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(arabic.dashboard.fairness.title);
  });

  test("starting again gives a fresh copy, and leaving ends the demo", async ({ page }) => {
    await startDemo(page);
    await seatAs(page, "Marcus");
    await page.getByRole("note").getByRole("button", { name: dashboard.shell.demo.restart }).click();
    await expect(page.getByRole("status").filter({ hasText: dashboard.notices.restarted })).toBeVisible();
    await expect(page.getByRole("note").getByRole("button", { name: /^You are Elena/ })).toBeVisible();

    await page.getByRole("note").getByRole("button", { name: dashboard.shell.demo.leave }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard$/);
  });
});

test.describe("the demo on a phone", () => {
  test.use({ viewport: { width: phone.width, height: phone.height } });

  test("puts the sections along the bottom, and the circle in the account menu", async ({ page }) => {
    await startDemo(page);
    const bar = page.getByRole("navigation", { name: dashboard.shell.navLabel });
    await expect(page.getByRole("complementary")).toBeHidden();
    await bar.getByRole("link", { name: dashboard.shell.nav.approvals }).click();
    await expect(page).toHaveURL("/dashboard/approvals");
    const menu = await openAccountMenu(page);
    await menu.getByRole("menuitem", { name: dashboard.shell.account.settings }).click();
    await expect(page).toHaveURL("/dashboard/circle");
  });

  test("shows the record as cards that open to their lines", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record");
    await expect(page.getByRole("region", { name: dashboard.record.grid.label })).toBeHidden();
    await page.getByRole("button", { name: dashboard.record.filters.care }).click();
    const cards = page.locator("details");
    await expect(cards).toHaveCount(4);
    await cards.first().locator("summary").click();
    await expect(cards.first().getByRole("table")).toContainText(dashboard.record.accounts.care_received);
  });

  test("never hides the last card under the bottom bar", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/approvals");
    await page.mouse.wheel(0, 20_000);
    const bar = await page.getByRole("navigation", { name: dashboard.shell.navLabel }).boundingBox();
    const lastCard = await page.locator("main section").last().boundingBox();
    expect(bar).not.toBeNull();
    expect(lastCard).not.toBeNull();
    if (bar && lastCard) expect(lastCard.y + lastCard.height).toBeLessThanOrEqual(bar.y);
  });
});
