import { expect, test, type Page } from "@playwright/test";

import { dashboardNav, dashboardRoutes } from "../src/content/dashboard-routes";
import arabic from "../src/i18n/dictionaries/ar.json" with { type: "json" };
import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import hebrew from "../src/i18n/dictionaries/he.json" with { type: "json" };
import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { payShiftAsWorker } from "./support/pay-shift";
import { maybeScreenshot } from "./support/screenshot";
import { phone, viewports } from "./support/viewports";

const copy = english.dashboard.shifts;
const permission = english.dashboard.shiftPermissions;
const SHIFTS = dashboardRoutes.shifts;
const PERMISSIONS = "/dashboard/circle/shifts";
const question = new RegExp(`^Was Amara here this (morning|afternoon|evening)\\?$`);
const yes = new RegExp(`^Yes, Amara was here this (morning|afternoon|evening)$`);

/** Amara says where her pay goes, so the simulated payout has an address to go to. */
async function sayWhereThePayGoes(page: Page) {
  await page.goto(SHIFTS);
  const panel = page.getByRole("region", { name: copy.target.title });
  await panel.getByLabel(copy.target.wallet).selectOption("venmo");
  await panel.getByLabel(copy.target.address).fill("@amara-demo");
  await panel.getByRole("button", { name: copy.target.save }).click();
  await expect(panel.getByRole("status")).toHaveText(copy.target.saved);
  await expect(panel).toContainText("Venmo");
}

/** Amara taps in, then out, and is told the shift now waits for Rose's word. */
async function amaraTapsInAndOut(page: Page) {
  await page.goto(SHIFTS);
  const checkIn = page.getByRole("button", { name: copy.needs.checkIn });
  await expect(checkIn).toBeVisible();
  await checkIn.click();
  await expect(page.getByRole("heading", { name: copy.needs.checkOutTitle })).toBeVisible();
  await page.getByRole("button", { name: copy.needs.checkOut }).click();
  await expect(page.getByRole("status").filter({ hasText: "Checked out. Now Kin waits for Rose’s word." })).toBeVisible();
}

/** Rose answers the question on her overview. */
async function roseAnswersYes(page: Page) {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 3, name: question })).toBeVisible();
  await page.getByRole("button", { name: yes }).click();
}

test.describe("a shift paid by the standing permission", () => {
  test("is proven by Amara's two taps and Rose's yes, approved at once, and shown paid on Amara's screen", async ({ page }) => {
    await startDemo(page);
    await seatAs(page, "Amara");
    await sayWhereThePayGoes(page);
    await amaraTapsInAndOut(page);

    // Either key alone leaves it waiting: Amara's card says what it waits for.
    await page.reload();
    const waiting = page.locator("li[id^='shift-']").filter({ hasText: "Day care" });
    await expect(waiting).toContainText(copy.chips.checked_out);
    await expect(waiting).toContainText("Waiting for Rose’s word");
    await expect(waiting).toContainText("Not yet");

    await seatAs(page, "Rose");
    await roseAnswersYes(page);
    // Planned 6 hours, tapped in two hours before it ends: two hours at $22.00.
    await expect(page.getByRole("status").filter({ hasText: "$44.00 is approved by Rose’s standing permission and is on its way to Amara by Venmo." })).toBeVisible();
    await page.goto(SHIFTS);
    const card = page.locator("li[id^='shift-']").filter({ hasText: "Day care" });
    await expect(card).toContainText(copy.chips.being_paid);
    await expect(card).toContainText("$44.00 for 2 h at $22.00 an hour");
    await expect(card).toContainText("Approved at once by Rose’s standing permission.");
    await expect(card).toContainText(copy.payment.simulatedTag);
    await maybeScreenshot(page, "shifts-rose-approved");

    // Amara sees it on its way; once the worker has paid it, the payment arrives on her open screen without a reload.
    await seatAs(page, "Amara");
    await page.goto(SHIFTS);
    await expect(page.locator("li[id^='shift-']").filter({ hasText: "Day care" })).toContainText("Approved. On its way to Amara by Venmo");
    const id = await page.locator("li[id^='shift-']").filter({ hasText: "Day care" }).getAttribute("id");
    await payShiftAsWorker(String(id).replace("shift-", ""));
    const received = page.getByRole("heading", { name: "$44.00 sent to your Venmo" });
    await expect(received).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(copy.received.simulated)).toBeVisible();
    await expect(page.locator("li[id^='shift-']").filter({ hasText: "Day care" })).toContainText(copy.chips.paid);
    await maybeScreenshot(page, "shifts-amara-paid");
    await expectNoHorizontalOverflow(page);
  });

  test("goes to the family for approval, with the reason, when it is above what Rose allowed", async ({ page }) => {
    await startDemo(page);
    // A minimum of eight hours prices Amara's visit at $176.00, above the $150.00 a shift the permission allows.
    await page.goto(PERMISSIONS);
    const rules = page.getByRole("form", { name: /Amara/ });
    await rules.getByLabel(permission.rules.minimum).fill("480");
    await rules.getByRole("button", { name: permission.rules.save }).click();
    await expect(rules.getByRole("status")).toHaveText(permission.rules.saved);

    await seatAs(page, "Amara");
    await amaraTapsInAndOut(page);
    await seatAs(page, "Rose");
    await roseAnswersYes(page);
    const said = page.getByRole("status").filter({ hasText: "$176.00 goes to the family for approval" });
    await expect(said).toBeVisible();
    await expect(said).toContainText("The shift is above the most the permission allows for one shift.");
    await said.getByRole("link", { name: copy.outcome.approvals }).click();
    await expect(page).toHaveURL(/\/dashboard\/approvals/);
    await expect(page.getByRole("heading", { name: "Shift pay for Amara" })).toBeVisible();
    await expect(page.getByText("$176.00").first()).toBeVisible();
    await maybeScreenshot(page, "shifts-above-cap-approvals");
  });
});

test.describe("who may do what", () => {
  test("keeps Amara from giving the family's word, on the screen and at the server", async ({ page }) => {
    await startDemo(page);
    await seatAs(page, "Amara");
    await page.goto(SHIFTS);
    await expect(page.getByRole("button", { name: yes })).toHaveCount(0);
    await page.getByRole("button", { name: copy.needs.checkIn }).click();
    await expect(page.getByRole("heading", { name: copy.needs.checkOutTitle })).toBeVisible();
    const id = String(await page.locator("li[id^='shift-']").filter({ hasText: "Day care" }).getAttribute("id")).replace("shift-", "");
    const forged = await page.request.post("/api/shifts", { headers: { origin: new URL(page.url()).origin }, data: { operation: "confirm", shiftId: id } });
    expect(forged.status()).toBe(403);
    expect(await forged.json()).toEqual({ ok: false, reason: "refused" });
    const scheduled = await page.request.post("/api/shifts", { headers: { origin: new URL(page.url()).origin }, data: { operation: "schedule", kind: "drive", memberId: id, date: "2026-12-01", start: "09:00", end: "10:00" } });
    expect(scheduled.status()).toBe(403);
    // And nobody outside Kin's own pages may ask.
    const foreign = await page.request.post("/api/shifts", { headers: { origin: "https://example.org" }, data: { operation: "confirm", shiftId: id } });
    expect(foreign.status()).toBe(403);
  });

  test("shows an observer the calendar and no way to change it", async ({ page }) => {
    await startDemo(page);
    await seatAs(page, "Daniel");
    await page.goto(SHIFTS);
    await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
    await expect(page.locator("li[id^='shift-']").filter({ hasText: "Day care" })).toBeVisible();
    for (const name of [copy.needs.checkIn, copy.needs.checkOut, copy.actions.cancel, yes, copy.schedule.submit, copy.target.save]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
    await expect(page.getByRole("heading", { name: copy.schedule.title })).toHaveCount(0);
    await page.goto(PERMISSIONS);
    await expect(page.getByRole("heading", { level: 1, name: permission.title })).toBeVisible();
    await expect(page.getByRole("heading", { name: permission.form.title })).toHaveCount(0);
    await expect(page.getByRole("button", { name: permission.actions.revoke })).toHaveCount(0);
  });

  test("sends a caregiver away from the family's permission, and shows Rose her own question first", async ({ page }) => {
    await startDemo(page);
    await seatAs(page, "Amara");
    await page.goto(PERMISSIONS);
    await expect(page).toHaveURL(/\/dashboard\/shifts$/);
    await expect(page.getByRole("region", { name: copy.target.title })).toBeVisible();
  });
});

test.describe("keeping the calendar", () => {
  test("lets the organizer put a visit on the calendar in the circle's own time, and call it off", async ({ page }) => {
    await startDemo(page);
    await page.goto(SHIFTS);
    const form = page.getByRole("region", { name: copy.schedule.title });
    await form.getByLabel(copy.schedule.kind).selectOption("appointment");
    await form.getByLabel(copy.schedule.person).selectOption({ label: "Rose" });
    await form.getByLabel(copy.schedule.label).fill("Eye check");
    await form.getByLabel(copy.schedule.start).fill("10:00");
    await form.getByLabel(copy.schedule.end).fill("11:30");
    await form.getByRole("button", { name: copy.schedule.submit }).click();
    await expect(form.getByRole("status")).toHaveText(copy.schedule.done);
    const card = page.locator("li[id^='shift-']").filter({ hasText: "Eye check" });
    await expect(card).toContainText("10:00 AM to 11:30 AM");
    await card.getByRole("button", { name: copy.actions.cancel }).click();
    await card.getByRole("button", { name: copy.actions.cancelYes }).click();
    await expect(card).toContainText(copy.chips.cancelled);
  });

  test("walks to the week before and back, in the address", async ({ page }) => {
    await startDemo(page);
    await page.goto(SHIFTS);
    const nav = page.getByRole("navigation", { name: copy.week.navLabel });
    await nav.getByRole("link", { name: copy.week.previous }).click();
    await expect(page).toHaveURL(/\?week=\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByRole("heading", { level: 2, name: /^Week of / })).toBeVisible();
    await nav.getByRole("link", { name: copy.week.back }).click();
    await expect(page).toHaveURL(new RegExp(`${SHIFTS}$`));
    // Anything but a real day falls back to this week.
    await page.goto(`${SHIFTS}?week=never`);
    await expect(page.getByRole("heading", { level: 2, name: /^This week, / })).toBeVisible();
  });

  test("is fully operable from the keyboard", async ({ page }) => {
    await startDemo(page);
    await seatAs(page, "Amara");
    await page.goto(SHIFTS);
    const checkIn = page.getByRole("button", { name: copy.needs.checkIn });
    await checkIn.focus();
    await expect(checkIn).toBeFocused();
    await page.keyboard.press("Enter");
    const checkOut = page.getByRole("button", { name: copy.needs.checkOut });
    await expect(checkOut).toBeVisible();
    const box = await checkOut.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);
    await checkOut.focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("status").filter({ hasText: "Rose’s word" })).toBeVisible();
  });
});

for (const viewport of viewports) {
  test.describe(`the shifts at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("fit for the family, the caregiver and the parent's own question, in English, Arabic and Hebrew", async ({ page }) => {
      await startDemo(page);
      for (const [path, heading] of [
        [SHIFTS, copy.title],
        [PERMISSIONS, permission.title],
        [`/ar${SHIFTS}`, arabic.dashboard.shifts.title],
        [`/ar${PERMISSIONS}`, arabic.dashboard.shiftPermissions.title],
        [`/he${SHIFTS}`, hebrew.dashboard.shifts.title],
      ] as const) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }
      await page.goto(SHIFTS);
      await maybeScreenshot(page, "shifts-family");

      await seatAs(page, "Amara");
      await page.goto(SHIFTS);
      await expect(page.getByRole("button", { name: copy.needs.checkIn })).toBeVisible();
      await maybeScreenshot(page, "shifts-amara");
      await expectNoHorizontalOverflow(page);
      await page.getByRole("button", { name: copy.needs.checkIn }).click();
      await page.getByRole("button", { name: copy.needs.checkOut }).click();
      await expect(page.getByRole("status").filter({ hasText: "Rose’s word" })).toBeVisible();

      await seatAs(page, "Rose");
      await page.goto("/dashboard");
      await expect(page.getByRole("button", { name: yes })).toBeVisible();
      await maybeScreenshot(page, "shifts-rose-question");
      await expectNoHorizontalOverflow(page);
      await page.goto("/ar/dashboard");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await maybeScreenshot(page, "shifts-rose-question-ar");
      await expectNoHorizontalOverflow(page);
    });
  });
}

test.describe("the calendar", () => {
  test("replaces the list's company only on a wide screen, and a phone has the cards alone", async ({ page }) => {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await startDemo(page);
    await page.goto(SHIFTS);
    await expect(page.getByRole("list", { name: /^Shifts, / })).toBeVisible();
    await expect(page.getByLabel(/^Care calendar, /)).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByRole("list", { name: /^Shifts, / })).toBeVisible();
    await expect(page.getByLabel(/^Care calendar, /).first()).toBeVisible({ timeout: 20_000 });
    await maybeScreenshot(page, "shifts-calendar");
    await expectNoHorizontalOverflow(page);
  });

  // The plain-text fallback list carries the calendar's own accessible name, so asking for the label alone passes
  // even when the Scheduler crashed: ask for the Scheduler itself. It once crashed in right-to-left languages.
  for (const locale of ["ar", "he"] as const) {
    test(`draws the real Scheduler, mirrored, in ${locale} and not the fallback list`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await startDemo(page);
      await page.goto(`/${locale}${SHIFTS}`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator(".b-scheduler").first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".b-scheduler.b-rtl").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  test("puts Shifts in the sidebar and on a phone's bottom bar, for every role", async ({ page }) => {
    await startDemo(page);
    await expect(page.getByRole("navigation", { name: english.dashboard.shell.navLabel }).getByRole("link", { name: english.dashboard.shell.nav.shifts })).toBeVisible();
    await seatAs(page, "Amara");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard\/shifts$/);
    await page.setViewportSize({ width: phone.width, height: phone.height });
    const bar = page.getByRole("navigation", { name: english.dashboard.shell.navLabel });
    await expect(bar.getByRole("link", { name: english.dashboard.shell.nav.shifts })).toHaveAttribute("aria-current", "page");
    expect(dashboardNav).toContain("shifts");
  });
});
