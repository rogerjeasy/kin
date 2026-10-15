import { expect, test } from "@playwright/test";

import { dashboardNav, dashboardRoutes } from "../src/content/dashboard-routes";
import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { IDENTITY_PROVIDER } from "./support/identity-provider";
import { laptop, viewports } from "./support/viewports";

const { dashboard } = english;
const paths = dashboardNav.map((section) => dashboardRoutes[section]);

// A person who signed in and belongs to no circle yet. They see no demo data
// anywhere, only the way to start their own circle.

for (const viewport of viewports) {
  test.describe(`a new account at ${viewport.width}×${viewport.height} (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("is offered to start a circle, on a screen that fits", async ({ page }) => {
      for (const path of [dashboardRoutes.overview, "/ar/dashboard", "/de/dashboard/bills"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }
    });
  });
}

test.describe("a new account", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });

  test("sees no demo data on any screen, only the way to start a circle", async ({ page }) => {
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(dashboard.createCircle.title);
      await expect(page.getByRole("main")).not.toContainText(/Rose|Elena|Marcus|Amara|Northfield|Demo circle/);
    }
  });

  test("is told who is signed in, and can sign out from there", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("main")).toContainText(IDENTITY_PROVIDER.person.name);
    await expect(page.getByRole("main")).toContainText(IDENTITY_PROVIDER.person.email);
    await expect(page.getByRole("button", { name: dashboard.shell.account.signOut })).toBeVisible();
  });

  test("is asked for the parent and how they take part, with every field labelled", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByLabel(dashboard.createCircle.parentName.label)).toBeVisible();
    await expect(page.getByLabel(dashboard.createCircle.name.label)).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(3);
    await expect(page.getByLabel(dashboard.createCircle.timezone.label)).toBeVisible();
  });
});
