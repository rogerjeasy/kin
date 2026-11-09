import { expect, test, type Page } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { maybeScreenshot } from "./support/screenshot";
import { viewports } from "./support/viewports";

const copy = english.dashboard.shifts;
const cover = english.dashboard.shiftCover;
const SHIFTS = "/dashboard/shifts";

/** A day on the circle's calendar some days after the demo's own. */
const inDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The organizer puts a paid shift for Amara on the calendar a few days ahead and then calls it off, which is what
 * leaves a shift that still lies ahead with nobody on it. The demo's own shift for today has already begun.
 */
async function scheduleAndCallOff(page: Page): Promise<string> {
  await page.goto(SHIFTS);
  const form = page.getByRole("region", { name: copy.schedule.title });
  await form.getByLabel(copy.schedule.person).selectOption({ label: "Amara" });
  await form.getByLabel(copy.schedule.label).fill("Evening care");
  const today = await form.getByLabel(copy.schedule.date).inputValue();
  await form.getByLabel(copy.schedule.date).fill(inDays(today, 2));
  await form.getByLabel(copy.schedule.start).fill("14:00");
  await form.getByLabel(copy.schedule.end).fill("18:00");
  await form.getByRole("button", { name: copy.schedule.submit }).click();
  await expect(form.getByRole("status")).toHaveText(copy.schedule.done);
  const week = `${SHIFTS}?week=${inDays(today, 2)}`;
  await page.goto(week);
  const card = page.locator("li[id^='shift-']").filter({ hasText: "Evening care" });
  await card.getByRole("button", { name: copy.actions.cancel }).click();
  await card.getByRole("button", { name: copy.actions.cancelYes }).click();
  await expect(card).toContainText(copy.chips.cancelled);
  // Where the shift is on the calendar, for a look at it later.
  return week;
}

test("offers cover when an aide calls off, and puts the chosen person on the calendar only when a person presses the button", async ({ page }) => {
  await startDemo(page);
  await page.goto(SHIFTS);
  await expect(page.getByRole("region", { name: cover.title })).toHaveCount(0);
  const week = await scheduleAndCallOff(page);
  await page.goto(SHIFTS);

  const section = page.getByRole("region", { name: cover.title });
  await expect(section).toBeVisible();
  await expect(section).toContainText(cover.decides);
  const card = section.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3 }) }).first();
  await expect(card.getByRole("heading", { level: 3 })).toContainText("Amara called off a shift that has not happened yet");
  // Claude words the note, from the record's hours, and the card says so.
  await expect(card.getByText(/ is free and has .* this week\.$/)).toBeVisible();
  await expect(card.getByText(/^Worded by Claude/)).toBeVisible();
  // Family would count as a care visit; nobody is offered money.
  const people = card.getByRole("list", { name: cover.candidates }).getByRole("listitem");
  await expect(people.first()).toContainText(cover.visit);
  await expect(card).not.toContainText("$");
  // Nothing is booked until a person presses a button.
  await page.goto(week);
  await expect(page.locator("li[id^='shift-']").filter({ hasText: "Evening care" })).toHaveCount(1);
  await page.goto(SHIFTS);

  const first = people.first();
  const name = (await first.locator("p").first().innerText()).trim();
  await first.getByRole("button", { name: `Ask ${name} to cover` }).click();
  // The page refreshes as soon as the shift is booked and the card goes with it, so the confirmation may be
  // gone before it is read: either the words are there or the card already is not.
  await expect(async () => {
    if ((await section.count()) === 0) return;
    await expect(section.getByRole("status")).toContainText(`${name} is now on the calendar for this shift.`, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole("region", { name: cover.title })).toHaveCount(0);
  await page.goto(week);
  await expect(page.locator("li[id^='shift-']").filter({ hasText: "Evening care" })).toHaveCount(2);
});

for (const viewport of viewports) {
  test(`fits the screen with no sideways scroll at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await scheduleAndCallOff(page);
    await page.goto(SHIFTS);
    await expect(page.getByRole("region", { name: cover.title })).toBeVisible();
    await maybeScreenshot(page, "shifts-cover");
    await expectNoHorizontalOverflow(page);
  });
}

test("is offered to the parent, and to no caregiver, and no observer", async ({ page }) => {
  await startDemo(page);
  await scheduleAndCallOff(page);
  await seatAs(page, "Rose");
  await page.goto(SHIFTS);
  await expect(page.getByRole("region", { name: cover.title })).toBeVisible();
  await seatAs(page, "Amara");
  await page.goto(SHIFTS);
  await expect(page.getByRole("region", { name: cover.title })).toHaveCount(0);
  await seatAs(page, "Daniel");
  await page.goto(SHIFTS);
  await expect(page.getByRole("region", { name: cover.title })).toHaveCount(0);
});

test("is refused at the server to anyone who may not schedule, even if they send the request themselves", async ({ page }) => {
  await startDemo(page);
  await scheduleAndCallOff(page);
  await seatAs(page, "Daniel");
  await page.goto(SHIFTS);
  const origin = new URL(page.url()).origin;
  const sent = await page.request.post("/api/shifts", { headers: { origin }, data: { operation: "schedule", kind: "visit", memberId: "00000000-0000-4000-8000-000000000000", date: "2026-12-01", start: "09:00", end: "10:00" } });
  expect(sent.status()).toBe(403);
});
