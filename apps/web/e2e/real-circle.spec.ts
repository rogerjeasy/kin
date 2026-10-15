import { expect, test } from "@playwright/test";

import { dashboardNav, dashboardRoutes } from "../src/content/dashboard-routes";
import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { fill } from "../src/i18n/template";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { IDENTITY_PROVIDER } from "./support/identity-provider";
import { laptop, viewports } from "./support/viewports";

const { dashboard } = english;
const paths = dashboardNav.map((section) => dashboardRoutes[section]);

// The one signed-in person starts their own circle. The tests run in order:
// the first creates it, the rest read the empty circle it leaves.
test.describe.configure({ mode: "serial" });

test.describe("a person's own circle", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });

  test("is started from the form, with the person as organizer", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByLabel(dashboard.createCircle.parentName.label).fill("Meera");
    await page.getByLabel(dashboard.createCircle.name.label).fill("Mum’s circle");
    await page.getByRole("radio", { name: new RegExp(dashboard.circle.parent.levels.informed.title) }).check();
    await page.getByLabel(dashboard.createCircle.timezone.label).selectOption("Europe/London");
    await page.getByRole("button", { name: dashboard.createCircle.submit }).click();

    await expect(page).toHaveURL("/dashboard?notice=circleCreated");
    await expect(page.getByRole("status").filter({ hasText: dashboard.notices.circleCreated })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fill(dashboard.overview.greeting, { name: IDENTITY_PROVIDER.person.name }));
    await expect(page.getByRole("complementary")).toContainText("Mum’s circle");
  });

  test("shows a proper message, not demo data, wherever it has nothing yet", async ({ page }) => {
    const expected: Record<string, string> = {
      "/dashboard": dashboard.empty.activity,
      "/dashboard/approvals": dashboard.approvals.waitingEmpty,
      "/dashboard/bills": dashboard.empty.comingUp,
      "/dashboard/fairness": dashboard.empty.fairness,
      "/dashboard/record": dashboard.empty.record,
      "/dashboard/circle": dashboard.empty.agreement,
    };
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole("main")).toContainText(expected[path] ?? "");
      await expect(page.getByRole("main")).not.toContainText(/Rose|Elena|Marcus|Amara|Northfield|\$382\.18/);
      await expect(page.getByRole("note")).toHaveCount(0);
    }
  });

  test("lists the person and the parent as its members", async ({ page }) => {
    await page.goto("/dashboard/circle");
    const main = page.getByRole("main");
    await expect(main).toContainText(`${IDENTITY_PROVIDER.person.name} (${dashboard.common.you})`);
    await expect(main).toContainText("Meera");
    await expect(main).toContainText(fill(dashboard.circle.parent.title, { parent: "Meera" }));
  });

  test("takes an invitation from its organizer", async ({ page }) => {
    await page.goto("/dashboard/circle");
    await page.getByRole("main").getByRole("button", { name: dashboard.circle.members.invite }).click();
    await page.getByLabel(dashboard.circle.invite.email).fill("ravi@example.com");
    await page.getByRole("button", { name: dashboard.circle.invite.submit }).click();
    await expect(page.getByRole("region", { name: dashboard.circle.invitations.title })).toContainText("ravi@example.com");
  });

  for (const viewport of viewports) {
    test(`fits at ${viewport.width}×${viewport.height} (${viewport.name}) on every screen`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const path of paths) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }
    });
  }
});
