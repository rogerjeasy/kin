import { expect, test, type Page } from "@playwright/test";

import { startDemo, seatAs } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { viewports } from "./support/viewports";
import french from "../src/i18n/dictionaries/fr.json" with { type: "json" };
import arabic from "../src/i18n/dictionaries/ar.json" with { type: "json" };

async function configure(page: Page, name?: string) {
  await page.goto("/dashboard/circle");
  const setup = page.getByRole("region", { name: "Caregiver rates" });
  if (name) await setup.getByLabel("Payee name").fill(name);
  await setup.getByLabel("Hourly rate").fill("22.00");
  await setup.getByRole("button", { name: "Save rate" }).click();
  await expect(setup.getByRole("status")).toContainText("Rate saved");
}

/** The caregiver says where their own pay goes; only a masked address is ever shown back. */
async function addReceiver(page: Page, email: string) {
  await page.goto("/dashboard/bills");
  const panel = page.getByRole("region", { name: "Where your pay goes" });
  await panel.getByLabel("Your PayPal email for payouts").fill(email);
  await panel.getByRole("button", { name: "Save address" }).click();
  await expect(panel.getByRole("status")).toContainText("Address saved");
  await expect(panel.getByText(`Payouts go to ${email.slice(0, 1)}••••${email.slice(email.indexOf("@"))}`)).toBeVisible();
}

for (const viewport of [...viewports, { name: "narrow", width: 320, height: 740 }]) {
  test.describe(`caregiver billing at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });
    test("sets the rate, reviews and submits a bill that the family can inspect", async ({ page }) => {
      await startDemo(page);
      await configure(page);
      await expectNoHorizontalOverflow(page);
      await seatAs(page, "Amara");
      await addReceiver(page, "amara.ndlovu@personal.example.com");
      await expectNoHorizontalOverflow(page);
      await page.goto("/dashboard/bills");
      const form = page.getByRole("region", { name: "Bill for your visits" });
      await form.getByLabel("Service date").fill("2026-10-01");
      await form.getByLabel("Hours", { exact: true }).fill("4");
      await form.getByRole("button", { name: "Review bill" }).click();
      await expect(form).toContainText("$88.00");
      await expectNoHorizontalOverflow(page);
      if (viewport.name === "phone" || viewport.name === "laptop") await page.screenshot({ path: test.info().outputPath(`caregiver-bill-${viewport.name}.png`), fullPage: true });
      await form.getByRole("button", { name: "Submit bill" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Bill submitted" })).toBeVisible();
      await page.reload();
      const submitted = page.getByRole("region", { name: "Submitted caregiver bills" });
      await expect(submitted).toContainText("$88.00");
      await expect(submitted).toContainText("Awaiting family review");
      await expectNoHorizontalOverflow(page);
      await seatAs(page, "Elena");
      await page.goto("/dashboard/bills");
      const review = page.getByRole("region", { name: "Submitted caregiver bills" });
      await expect(review).toContainText("$88.00");
      await expectNoHorizontalOverflow(page);

      // The family sends it for approval: a proposal for the bill's own amount, which pays nothing yet.
      await review.getByRole("button", { name: "Send for approval" }).click();
      await expect(review).toContainText("Waiting for the family’s approval");
      await review.getByRole("link", { name: "Follow it in Approvals" }).click();
      const proposal = page.getByRole("article", { name: "Amara’s bill for completed visits" });
      await expect(proposal).toContainText("$88.00");
      // The family sees where the money will go before saying yes.
      await expect(proposal).toContainText("Paid by PayPal to a••••@personal.example.com, the address Amara gave");
      await expectNoHorizontalOverflow(page);

      // $88.00 is above Rose's $50.00, so Rose decides.
      await seatAs(page, "Rose");
      await page.goto("/dashboard/approvals");
      await page.getByRole("article", { name: "Amara’s bill for completed visits" }).getByRole("button", { name: "Approve" }).click();
      await expect(page).toHaveURL(/notice=approved/);
      await seatAs(page, "Amara");
      await page.goto("/dashboard/bills");
      await expect(page.getByRole("region", { name: "Submitted caregiver bills" })).toContainText("Approved · payment comes next");
      await expectNoHorizontalOverflow(page);
    });
  });
}

test("declines a bill after asking once more, and takes a corrected bill for the same day", async ({ page }) => {
  await startDemo(page);
  await configure(page);
  await seatAs(page, "Amara");
  await page.goto("/dashboard/bills");
  const form = page.getByRole("region", { name: "Bill for your visits" });
  const submit = async (hours: string) => {
    await form.getByLabel("Service date").fill("2026-10-02");
    await form.getByLabel("Hours", { exact: true }).fill(hours);
    await form.getByRole("button", { name: "Review bill" }).click();
    await form.getByRole("button", { name: "Submit bill" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Bill submitted" })).toBeVisible();
  };
  await submit("5");
  await seatAs(page, "Marcus");
  await page.goto("/dashboard/bills");
  const bills = page.getByRole("region", { name: "Submitted caregiver bills" });
  await bills.getByRole("button", { name: "Decline bill" }).click();
  await bills.getByRole("button", { name: "Keep it" }).click();
  await bills.getByRole("button", { name: "Decline bill" }).click();
  await bills.getByRole("button", { name: "Yes, decline" }).click();
  await expect(bills).toContainText("Rejected");
  await expect(bills.getByRole("button", { name: "Send for approval" })).toHaveCount(0);

  await seatAs(page, "Amara");
  await page.goto("/dashboard/bills");
  await submit("4");
  await page.reload();
  await expect(page.getByRole("region", { name: "Submitted caregiver bills" })).toContainText("$88.00");
});

test("shows no review buttons to the caregiver, the parent or an observer", async ({ page }) => {
  await startDemo(page);
  await configure(page);
  await seatAs(page, "Amara");
  await page.goto("/dashboard/bills");
  const form = page.getByRole("region", { name: "Bill for your visits" });
  await form.getByLabel("Service date").fill("2026-10-03");
  await form.getByLabel("Hours", { exact: true }).fill("2");
  await form.getByRole("button", { name: "Review bill" }).click();
  await form.getByRole("button", { name: "Submit bill" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Bill submitted" })).toBeVisible();
  // Amara is the seat already taken; then the parent and the observer.
  for (const name of [null, "Rose", "Daniel"]) {
    if (name) await seatAs(page, name);
    await page.goto("/dashboard/bills");
    await expect(page.getByRole("region", { name: "Submitted caregiver bills" })).toContainText("$44.00");
    await expect(page.getByRole("button", { name: "Send for approval" })).toHaveCount(0);
  }
});

test("keeps entered visits on duplicate feedback and lets the caregiver correct a review", async ({ page }) => {
  await startDemo(page);
  await configure(page);
  await seatAs(page, "Amara");
  await page.goto("/dashboard/bills");
  const form = page.getByRole("region", { name: "Bill for your visits" });
  await form.getByLabel("Service date").fill("2026-10-01");
  await form.getByLabel("Hours", { exact: true }).fill("4");
  await form.getByRole("button", { name: "Review bill" }).click();
  await form.getByRole("button", { name: "Change visits" }).click();
  await expect(form.getByLabel("Hours", { exact: true })).toHaveValue("4");
  await form.getByRole("button", { name: "Review bill" }).click();
  await form.getByRole("button", { name: "Submit bill" }).click();
  // Reloading before the bill is saved would cancel the submission it depends on.
  await expect(page.getByRole("status").filter({ hasText: "Bill submitted" })).toBeVisible();
  await page.reload();
  await form.getByLabel("Service date").fill("2026-10-01");
  await form.getByLabel("Hours", { exact: true }).fill("4");
  await form.getByRole("button", { name: "Review bill" }).click();
  await form.getByRole("button", { name: "Submit bill" }).click();
  await expect(form.getByRole("alert")).toContainText("already billed");
  await form.getByRole("link", { name: "View earlier bill" }).click();
  await expect(page.locator(":target")).toContainText("$88.00");
  await form.getByRole("button", { name: "Change visits" }).click();
  await expect(form.getByLabel("Service date")).toHaveValue("2026-10-01");
});

for (const [locale, copy] of [["fr", french.dashboard.caregiverBilling], ["ar", arabic.dashboard.caregiverBilling]] as const) {
  test(`keeps a long caregiver name readable in ${locale} on a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await startDemo(page);
    const name = "Amara Ndlovu García Müller — Northfield Community Home Care Team";
    await configure(page, name);
    await seatAs(page, "Amara");
    await page.goto(`/${locale}/dashboard/bills`);
    const form = page.getByRole("region", { name: copy.formTitle });
    await expect(form.getByText(name, { exact: true })).toBeVisible();
    await form.getByLabel(copy.date).fill("2025-10-01");
    await form.getByLabel(copy.hours, { exact: true }).fill("4");
    await form.getByRole("button", { name: copy.review }).click();
    await expect(form.locator("time")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

test("keeps the service year visible, supports keyboard confirmation and reflows at 200% text", async ({ page }) => {
  await startDemo(page);
  await configure(page);
  await seatAs(page, "Amara");
  await page.goto("/dashboard/bills");
  const form = page.getByRole("region", { name: "Bill for your visits" });
  await form.getByLabel("Service date").fill("2025-10-01");
  await form.getByLabel("Hours", { exact: true }).fill("4");
  await form.getByRole("button", { name: "Review bill" }).focus();
  await page.keyboard.press("Enter");
  await expect(form.locator("time")).toContainText("2025");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expectNoHorizontalOverflow(page);
  await form.getByRole("button", { name: "Submit bill" }).focus();
  await page.keyboard.press("Enter");
  await expect(form.getByRole("status")).toContainText("Bill submitted");
  await expectNoHorizontalOverflow(page);
});

test("shows a missing rate and gives an observer no billing controls", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Amara");
  await page.goto("/dashboard/bills");
  await expect(page.getByText("Ask the organizer to record your hourly rate before you bill.")).toBeVisible();
  await seatAs(page, "Daniel");
  await page.goto("/dashboard/circle");
  await expect(page.getByRole("button", { name: "Save rate" })).toHaveCount(0);
  await page.goto("/dashboard/bills");
  await expect(page.getByRole("button", { name: "Review bill" })).toHaveCount(0);
});

test("refuses unauthenticated and foreign-origin billing requests", async ({ request, baseURL }) => {
  expect((await request.post("/api/caregiver-billing", { headers: { origin: "https://evil.example" }, data: { operation: "review", visits: [] } })).status()).toBe(403);
  expect((await request.post("/api/caregiver-billing", { headers: { origin: baseURL ?? "" }, data: { operation: "review", visits: [] } })).status()).toBe(401);
});

test("a duplicate from another tab refreshes the earlier bill without losing entered visits", async ({ page, context }) => {
  // Two concurrent review-and-submit journeys, rather than one page visit.
  test.slow();
  await startDemo(page);
  await configure(page);
  await seatAs(page, "Amara");
  await page.goto("/dashboard/bills");
  const second = await context.newPage();
  await second.goto("/dashboard/bills");
  for (const tab of [page, second]) {
    const form = tab.getByRole("region", { name: "Bill for your visits" });
    await form.getByLabel("Service date").fill("2025-10-01");
    await form.getByLabel("Hours", { exact: true }).fill("4");
    await form.getByRole("button", { name: "Review bill" }).click();
    await expect(form).toContainText("$88.00");
  }
  await page.getByRole("button", { name: "Submit bill" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Bill submitted" })).toBeVisible();
  const form = second.getByRole("region", { name: "Bill for your visits" });
  await form.getByRole("button", { name: "Submit bill" }).click();
  await expect(second.getByRole("region", { name: "Submitted caregiver bills" })).toContainText("$88.00");
  await form.getByRole("link", { name: "View earlier bill" }).click();
  await expect(second.locator(":target")).toContainText("$88.00");
  await form.getByRole("button", { name: "Change visits" }).click();
  await expect(form.getByLabel("Service date")).toHaveValue("2025-10-01");
  await second.close();
});

test("fills in the days from the caregiver's own words, which the caregiver then reviews", async ({ page }) => {
  await startDemo(page);
  await configure(page);
  await seatAs(page, "Amara");
  await page.goto("/dashboard/bills");
  const form = page.getByRole("region", { name: "Bill for your visits" });
  await form.getByLabel("Or describe your visits in your own words").fill("Yesterday 4 hours with Rose.");
  await form.getByRole("button", { name: "Fill in the days" }).click();
  await expect(form.getByRole("status")).toContainText("Kin filled in the days below from your words.");
  await expect(form.getByLabel("Hours", { exact: true })).toHaveValue("4");
  await expectNoHorizontalOverflow(page);
  // Nothing is sent until the caregiver reviews: the server values the days.
  await form.getByRole("button", { name: "Review bill" }).click();
  await expect(form).toContainText("$88.00");

  await form.getByRole("button", { name: "Change visits" }).click();
  await form.getByLabel("Or describe your visits in your own words").fill("Please decline this.");
  await form.getByRole("button", { name: "Fill in the days" }).click();
  await expect(form.getByRole("alert")).toHaveText("Kin could not read that description. Enter the days below instead.");
});

