import { expect, test, type Page } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { payShiftAsWorker } from "./support/pay-shift";
import { maybeScreenshot } from "./support/screenshot";
import { phone, viewports } from "./support/viewports";

const copy = english.dashboard.wishes;
const shifts = english.dashboard.shifts;
const WISHES = "/dashboard/circle/wishes";
const KEEP_AMARA = "Always keep paying Amara, even if I'm in hospital.";

/** A tiny WAV, so the play button has something to play when the browser asks for her words. */
const SILENCE = Buffer.concat([Buffer.from("RIFF"), Buffer.from([36 + 8, 0, 0, 0]), Buffer.from("WAVEfmt "), Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 0x80, 0x3e, 0, 0, 0, 0x7d, 0, 0, 2, 0, 16, 0]), Buffer.from("data"), Buffer.from([8, 0, 0, 0]), Buffer.alloc(8)]);

async function tap(page: Page, name: string) {
  await page.goto(WISHES);
  await page.getByRole("button", { name }).click();
}

for (const viewport of viewports) {
  test(`Rose's wishes read clearly for the family and for Rose herself, at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await page.goto(WISHES);
    await expect(page.getByRole("heading", { level: 1, name: "Rose’s wishes" })).toBeVisible();
    await expect(page.getByText(copy.legal)).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(4);
    await expect(page.getByRole("article").filter({ hasText: KEEP_AMARA })).toContainText("Confirmed by Rose, witnessed by Elena and Marcus");
    await expect(page.getByRole("button", { name: "Hear Rose’s words, read by Kin" }).first()).toBeVisible();
    await expect(page.getByText(copy.play.voiceKin).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Rose is in hospital" })).toBeVisible();
    await maybeScreenshot(page, "wishes-family");
    await expectNoHorizontalOverflow(page);

    await seatAs(page, "Rose");
    await page.goto(WISHES);
    await expect(page.getByRole("heading", { level: 1, name: copy.titleOwn })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.record.speak })).toBeVisible();
    await expect(page.getByLabel(copy.record.label)).toBeVisible();
    // She cannot set off a trigger herself.
    await expect(page.getByRole("button", { name: "Rose is in hospital" })).toHaveCount(0);
    await maybeScreenshot(page, "wishes-own");
    await expectNoHorizontalOverflow(page);
  });
}

test("Elena and Marcus say Rose is in hospital: her wishes take effect, Amara's next shift is paid, and coming home undoes it", async ({ page }) => {
  await page.route("**/api/wishes/audio", (route) => route.fulfill({ status: 200, contentType: "audio/wav", body: SILENCE }));
  await startDemo(page);
  // Amara says where her pay goes, so her shift can be paid.
  await seatAs(page, "Amara");
  await page.goto("/dashboard/shifts");
  const target = page.getByRole("region", { name: shifts.target.title });
  await target.getByLabel(shifts.target.wallet).selectOption("venmo");
  await target.getByLabel(shifts.target.address).fill("@amara-demo");
  await target.getByRole("button", { name: shifts.target.save }).click();
  await expect(target.getByRole("status")).toHaveText(shifts.target.saved);

  // One person's word reports it; nothing changes yet.
  await seatAs(page, "Elena");
  await tap(page, "Rose is in hospital");
  await expect(page.getByRole("status").filter({ hasText: "Elena said Rose is in hospital. Her wishes apply once someone else says so too." }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: copy.changed.title })).toHaveCount(0);
  await expect(page.getByText(copy.trigger.youSaid)).toBeVisible();

  // A second person's word makes it active, and the screen says what changed and why.
  await seatAs(page, "Marcus");
  await tap(page, "Rose is in hospital");
  await expect(page.getByRole("heading", { name: copy.changed.title })).toBeVisible();
  const changes = page.getByRole("region", { name: copy.changed.title });
  await expect(changes).toContainText("Amara stays paid.");
  await expect(changes).toContainText(`Rose said on`);
  await expect(changes).toContainText(KEEP_AMARA);
  await expect(changes).toContainText("Lakeside Fitness ($39.00 a month) is paused.");
  await expect(changes).toContainText("Garden Monthly ($12.50 a month) is paused.");
  await expect(changes).toContainText(copy.changed.discretionary);
  await expect(changes).toContainText("A payment over $200.00 to anyone new now needs Elena and Marcus.");
  await expect(changes.getByText(copy.simulated).first()).toBeVisible();
  // Her words are one tap away, labelled as Kin's voice reading them.
  const audio = page.waitForRequest((request) => request.url().endsWith("/api/wishes/audio"));
  await changes.getByRole("listitem").filter({ hasText: "Amara stays paid." }).getByRole("button", { name: "Hear Rose’s words, read by Kin" }).click();
  expect(JSON.parse((await audio).postData() ?? "{}")).toMatchObject({ locale: "en" });
  await expect(page.getByText(copy.play.unavailable)).toHaveCount(0);
  // While she is away nobody may change her wishes.
  await expect(page.getByText("While someone has said Rose is in hospital or a care home, her wishes stay exactly as they are.")).toBeVisible();
  await expect(page.getByRole("button", { name: copy.actions.witness })).toHaveCount(0);
  await maybeScreenshot(page, "wishes-active");
  await expectNoHorizontalOverflow(page);

  // Every screen says so, and the new stairlift company now needs Elena and Marcus both.
  for (const path of ["/dashboard", "/dashboard/approvals"]) {
    await page.goto(path);
    const banner = page.getByRole("status").filter({ hasText: "Rose is in hospital, and her wishes are in effect" });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("link", { name: copy.banner.link })).toHaveAttribute("href", WISHES);
  }
  const stairlift = page.getByRole("article", { name: "Stairlift repair" });
  await expect(stairlift).toContainText("Her wish asks Elena and Marcus to agree before this goes.");
  await expect(stairlift).toContainText("If I can't decide for myself, nothing over 200 dollars to anyone new unless Elena and Marcus both agree.");

  // Amara works her shift; Elena gives the family's word; it is paid, as Rose asked.
  await seatAs(page, "Amara");
  await page.goto("/dashboard/shifts");
  await page.getByRole("button", { name: shifts.needs.checkIn }).click();
  await expect(page.getByRole("heading", { name: shifts.needs.checkOutTitle })).toBeVisible();
  await page.getByRole("button", { name: shifts.needs.checkOut }).click();
  await expect(page.getByRole("status").filter({ hasText: "Checked out." })).toBeVisible();
  const id = await page.locator("li[id^='shift-']").filter({ hasText: "Day care" }).getAttribute("id");
  await seatAs(page, "Elena");
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /^Yes, Amara was here this (morning|afternoon|evening)$/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "$44.00 is approved by Rose’s standing permission" })).toBeVisible();
  await payShiftAsWorker(String(id).replace("shift-", ""));
  await page.goto(WISHES);
  await expect(page.getByRole("region", { name: copy.changed.title })).toContainText(/Paid \$44\.00 to Amara on/);

  // Rose is home: two people say so, and everything her wishes paused starts again.
  await tap(page, "Rose is home");
  await expect(page.getByRole("status").filter({ hasText: "Elena said Rose is home." })).toBeVisible();
  await seatAs(page, "Marcus");
  await tap(page, "Rose is home");
  await expect(page.getByRole("heading", { name: copy.changed.title })).toHaveCount(0);
  await expect(page.getByText(/Rose came home on/)).toBeVisible();
  await expect(page.getByRole("region", { name: "What Rose pays each month" })).not.toContainText(copy.subscriptions.states.suspended);
  await page.goto("/dashboard");
  await expect(page.getByRole("status").filter({ hasText: "her wishes are in effect" })).toHaveCount(0);
});

test("Rose says a new wish in her own words, Kin reads it back, she confirms it, and Elena and Marcus witness it", async ({ page }) => {
  await page.setViewportSize({ width: phone.width, height: phone.height });
  await startDemo(page);
  await seatAs(page, "Rose");
  await page.goto(WISHES);
  await page.getByLabel(copy.record.label).fill("If I go into a home, stop Garden Monthly. And sell my car to my neighbour.");
  await page.getByRole("button", { name: copy.record.readBack }).click();
  await expect(page.getByRole("heading", { name: copy.record.readBackTitle })).toBeVisible();
  const draft = page.getByRole("listitem").filter({ hasText: "If I go into a home, stop Garden Monthly." });
  await expect(draft).toContainText("If you move into a care home: Kin pauses Garden Monthly, and starts them again when you are home.");
  // What cannot be a rule is said so, and nothing is kept for it.
  await expect(page.getByRole("listitem").filter({ hasText: "And sell my car to my neighbour." })).toContainText(copy.record.flagged);
  await draft.getByRole("button", { name: copy.record.keep }).click();
  await expect(draft.getByRole("status")).toHaveText(copy.record.kept);
  await maybeScreenshot(page, "wishes-said");
  await expectNoHorizontalOverflow(page);

  const card = () => page.getByRole("article").filter({ hasText: "If I go into a home, stop Garden Monthly." });
  await page.reload();
  await expect(card()).toContainText(copy.states.confirmed);
  await seatAs(page, "Elena");
  await page.goto(WISHES);
  await card().getByRole("button", { name: copy.actions.witness }).click();
  await expect(card()).toContainText("Confirmed by Rose. 1 of 2 witnesses so far.");
  await expect(card().getByRole("button", { name: copy.actions.witness })).toHaveCount(0);
  await seatAs(page, "Marcus");
  await page.goto(WISHES);
  await card().getByRole("button", { name: copy.actions.witness }).click();
  await expect(card()).toContainText(copy.states.in_force);
  await expect(card()).toContainText("Confirmed by Rose, witnessed by Elena and Marcus");
  await expectNoHorizontalOverflow(page);
});

for (const locale of ["he", "ar", "de"] as const) {
  test(`the wishes screen reads in ${locale} on a 360 pixel phone with nothing overflowing`, async ({ page }) => {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await startDemo(page);
    await page.goto(`/${locale}${WISHES}`);
    await expect(page.getByRole("article")).toHaveCount(4);
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "de" ? "ltr" : "rtl");
    await maybeScreenshot(page, `wishes-${locale}`);
    await expectNoHorizontalOverflow(page);
  });
}

test("Amara, Rose's caregiver, sees only the trigger: she may say Rose went into hospital, and reads none of her wishes", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Amara");
  await page.goto(WISHES);
  await expect(page.getByRole("button", { name: "Rose is in hospital" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rose moved into a care home" })).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByText(KEEP_AMARA)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
