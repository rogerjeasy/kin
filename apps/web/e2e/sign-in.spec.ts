import { expect, test, type Page } from "@playwright/test";

import { dashboardNav, dashboardRoutes } from "../src/content/dashboard-routes";
import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import french from "../src/i18n/dictionaries/fr.json" with { type: "json" };
import { fill } from "../src/i18n/template";
import { openAccountMenu } from "./support/account-menu";
import { IDENTITY_PROVIDER } from "./support/identity-provider";
import { laptop } from "./support/viewports";

const { signInPage, startPage, dashboard } = english;
const SESSION_COOKIES = ["__Host-kin-access", "__Host-kin-id"];

test.use({ viewport: { width: laptop.width, height: laptop.height } });

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("link", { name: signInPage.form.submit }).click();
  await expect(page).toHaveURL("/dashboard");
}

async function cookieNames(page: Page): Promise<string[]> {
  return (await page.context().cookies()).map((cookie) => cookie.name);
}

for (const section of dashboardNav) {
  const path = dashboardRoutes[section];
  test(`${path} sends a signed-out visitor to sign in, and back to it afterwards`, async ({ page }) => {
    await page.goto(path);

    await expect(page).toHaveURL(`/sign-in?next=${encodeURIComponent(path)}`);
    await page.getByRole("link", { name: signInPage.form.submit }).click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}

test("a signed-out visitor to a French screen signs in in French and comes back to it", async ({ page }) => {
  await page.goto("/fr/dashboard/bills");

  await expect(page).toHaveURL(`/fr/sign-in?next=${encodeURIComponent("/fr/dashboard/bills")}`);
  await page.getByRole("link", { name: french.signInPage.form.submit }).click();
  await expect(page).toHaveURL("/fr/dashboard/bills");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
});

test("signing in greets the person by the name their account holds", async ({ page }) => {
  await signIn(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(fill(dashboard.overview.greeting, { name: IDENTITY_PROVIDER.person.name }));
  await expect(await openAccountMenu(page)).toContainText(IDENTITY_PROVIDER.person.email);
});

test("the session lives in cookies that page scripts cannot read", async ({ page }) => {
  await signIn(page);

  const cookies = await page.context().cookies();
  for (const name of SESSION_COOKIES) {
    expect(cookies.find((cookie) => cookie.name === name)).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
  }
  expect(await page.evaluate(() => document.cookie)).toBe("");
});

test("the start screen asks for the consent rule before creating an account", async ({ page }) => {
  await page.goto("/start");

  await page.getByRole("button", { name: startPage.form.submit }).click();
  await expect(page).toHaveURL("/start");
  await expect(page.getByRole("checkbox")).toBeFocused();
  await expect(page.getByRole("checkbox")).toHaveAccessibleDescription(startPage.form.consentError);

  await page.getByRole("checkbox").check();
  const signUp = page.waitForRequest((request) => new URL(request.url()).pathname === "/signup");
  await page.getByRole("button", { name: startPage.form.submit }).click();
  await signUp;
  await expect(page).toHaveURL("/dashboard");
});

test("Kin hosts no password field of its own", async ({ page }) => {
  for (const path of ["/sign-in", "/start"]) {
    await page.goto(path);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  }
});

test("an answer that does not carry this browser's state is refused", async ({ page }) => {
  await page.goto("/auth/callback?code=stolen&state=forged");

  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard&problem=failed$/);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(signInPage.form.problems.failed);
  expect(await cookieNames(page)).not.toContain(SESSION_COOKIES[0]);
});

test("a forged session cookie opens nothing", async ({ page }) => {
  await signIn(page);
  const cookies = await page.context().cookies();
  const access = cookies.find((cookie) => cookie.name === SESSION_COOKIES[0]);
  expect(access).toBeDefined();
  if (!access) return;
  const [header, , signature] = access.value.split(".");
  const payload = Buffer.from(JSON.stringify({ sub: "someone-else", token_use: "access", client_id: IDENTITY_PROVIDER.clientId })).toString("base64url");
  await page.context().clearCookies();
  await page.context().addCookies([{ ...access, value: `${header}.${payload}.${signature}` }]);

  await page.goto("/dashboard/record");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard%2Frecord/);
});

test("an expired session is renewed with the refresh token, without signing in again", async ({ page }) => {
  await signIn(page);
  const kept = (await page.context().cookies()).filter((cookie) => !SESSION_COOKIES.includes(cookie.name));
  await page.context().clearCookies();
  await page.context().addCookies(kept);

  await page.goto("/dashboard/fairness");
  await expect(page).toHaveURL("/dashboard/fairness");
  expect(await cookieNames(page)).toEqual(expect.arrayContaining(SESSION_COOKIES));
});

test("a link that tries to send someone elsewhere after signing in lands on the circle instead", async ({ page }) => {
  await page.goto("/auth/sign-in?next=https://evil.example/");

  await expect(page).toHaveURL("/dashboard");
});

test("a form on another site cannot sign anyone out", async ({ page }) => {
  await signIn(page);

  const response = await page.request.post("/auth/sign-out", { headers: { origin: "https://evil.example" }, maxRedirects: 0 });

  expect(response.status()).toBe(403);
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/dashboard");
});

test("signing out ends the session, and the circle's screens close again", async ({ page }) => {
  await signIn(page);

  const menu = await openAccountMenu(page);
  await menu.getByRole("menuitem", { name: dashboard.shell.account.signOut }).click();

  await expect(page).toHaveURL("/");
  expect(await cookieNames(page)).not.toEqual(expect.arrayContaining([SESSION_COOKIES[0]]));
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard$/);
});
