import { expect, test } from "@playwright/test";

import { EXAMPLE_EMAIL } from "../src/content/example-email";
import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { fill } from "../src/i18n/template";
import { laptop } from "./support/viewports";

const { nav } = english.common;
const { account, notOpen, pricingPage, howItWorks, signInPage, startPage } = english;

test.use({ viewport: { width: laptop.width, height: laptop.height } });

// Smooth scrolling takes a moment to carry a page away from the top. Reading
// the position at once would miss it.
const SETTLE_MS = 1_200;

const headerLinks = [
  { name: nav.howItWorks, path: "/how-it-works" },
  { name: nav.safety, path: "/safety" },
  { name: nav.caregivers, path: "/caregivers" },
  { name: nav.pricing, path: "/pricing" },
  { name: nav.signIn, path: "/sign-in" },
  { name: nav.start, path: "/start" },
];

for (const link of headerLinks) {
  test(`the header's "${link.name}" link opens ${link.path} at the top, not part of the way down it`, async ({ page }) => {
    await page.goto("/");

    await page.getByRole("banner").getByRole("link", { name: link.name, exact: true }).click();
    await expect(page).toHaveURL(link.path);
    await page.waitForTimeout(SETTLE_MS);

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
  });
}

test("a link clicked far down one page opens the next page at the top", async ({ page }) => {
  await page.goto("/how-it-works");
  await page.mouse.wheel(0, 3_000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1_000);

  await page.getByRole("banner").getByRole("link", { name: nav.pricing, exact: true }).click();
  await expect(page).toHaveURL("/pricing");
  await page.waitForTimeout(SETTLE_MS);

  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

for (const path of ["/start", "/sign-in"]) {
  test(`${path} is a screen of its own, without the site's menu or footer`, async ({ page }) => {
    await page.goto(path);

    await expect(page.getByRole("banner").getByRole("link", { name: english.common.brandHome })).toBeVisible();
    await expect(page.getByRole("link", { name: nav.pricing, exact: true })).toHaveCount(0);
    await expect(page.getByRole("contentinfo")).toHaveCount(0);
    await expect(page.getByRole("form")).toBeVisible();
  });
}

test("the start form says what each empty field needs, and moves to the first one", async ({ page }) => {
  await page.goto("/start");

  await page.getByRole("button", { name: startPage.form.submit }).click();

  const name = page.getByLabel(startPage.form.nameLabel);
  await expect(name).toBeFocused();
  await expect(name).toHaveAccessibleDescription(account.requiredError);
  await expect(page.getByLabel(account.emailLabel)).toHaveAccessibleDescription(
    fill(account.emailError, { example: EXAMPLE_EMAIL }),
  );
  await expect(page.getByRole("checkbox")).toHaveAccessibleDescription(startPage.form.consentError);
  await expect(page.getByRole("status")).toBeEmpty();
});

test("a complete start form answers that circles are not open, and sends nothing", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") sent.push(`${request.method()} ${request.url()}`);
  });
  await page.goto("/start");

  await page.getByLabel(startPage.form.nameLabel).fill("Elena");
  await page.getByLabel(account.emailLabel).fill(EXAMPLE_EMAIL);
  await page.getByLabel(startPage.form.parentLabel).fill("Rose");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: startPage.form.submit }).click();

  await expect(page.getByRole("status")).toContainText(notOpen.startTitle);
  expect(sent).toEqual([]);
  await expect(page).toHaveURL("/start");
});

test("the sign-in form refuses a malformed address, then answers that sign-in is not open", async ({ page }) => {
  await page.goto("/sign-in");
  const email = page.getByLabel(account.emailLabel);

  await email.fill("elena");
  await page.getByRole("button", { name: signInPage.form.submit }).click();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("status")).toBeEmpty();

  await email.fill(EXAMPLE_EMAIL);
  await page.getByRole("button", { name: signInPage.form.submit }).click();
  await expect(page.getByRole("status")).toContainText(notOpen.signInTitle);
  await expect(email).not.toHaveAttribute("aria-invalid", "true");
});

test("the sign-in screen asks for no password", async ({ page }) => {
  await page.goto("/sign-in");

  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.getByRole("button", { name: signInPage.form.passkey }).click();
  await expect(page.getByRole("status")).toContainText(notOpen.signInTitle);
});

test("each account screen leads to the other", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("main").getByRole("link", { name: nav.start, exact: true }).click();
  await expect(page).toHaveURL("/start");

  await page.getByRole("main").getByRole("link", { name: nav.signIn, exact: true }).click();
  await expect(page).toHaveURL("/sign-in");
});

test("a pricing question opens to show its answer, by keyboard", async ({ page }) => {
  await page.goto("/pricing");
  const [first] = pricingPage.faq.items;
  if (!first) throw new Error("the pricing page has no questions");
  const answer = page.getByText(first.answer);
  await expect(answer).toBeHidden();

  // The question is a heading inside the control. The control takes the focus.
  await page.locator("summary", { hasText: first.question }).focus();
  await page.keyboard.press("Enter");

  await expect(answer).toBeVisible();
});

test("every day of the month names who approved and which PayPal capability moved the money", async ({ page }) => {
  await page.goto("/how-it-works");

  const days = page.getByRole("region", { name: howItWorks.timeline.label }).getByRole("listitem");
  for (const entry of howItWorks.timeline.entries) {
    const day = days.filter({ hasText: entry.title });
    await expect(day.getByText(entry.approval, { exact: true })).toBeVisible();
    await expect(day.getByText(entry.paypal, { exact: true })).toBeVisible();
  }
});

test("the proposed plans lead with the free one and mark the family's", async ({ page }) => {
  await page.goto("/pricing");

  const plans = page.getByRole("list", { name: pricingPage.plans.label }).getByRole("heading", { level: 2 });

  await expect(plans).toHaveText([
    pricingPage.plans.cards.free.name,
    pricingPage.plans.cards.family.name,
    pricingPage.plans.cards.professional.name,
  ]);
});
