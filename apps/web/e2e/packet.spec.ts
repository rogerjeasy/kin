import { expect, test } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { maybeScreenshot } from "./support/screenshot";
import { viewports } from "./support/viewports";

const packet = english.dashboard.packet;
const agreements = english.dashboard.careAgreements;

for (const viewport of viewports) {
  test(`the packet screen shows the look-back and offers the download at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await page.goto("/dashboard/record/packet");
    await expect(page.getByRole("heading", { level: 1, name: packet.title })).toBeVisible();
    await expect(page.getByText(packet.tiles.chain.pass)).toBeVisible();
    await expect(page.getByRole("link", { name: packet.download })).toHaveAttribute("href", /\/dashboard\/record\/packet\/export$/);
    await expect(page.getByText(packet.notice)).toBeVisible();
    // Sixty months run across years, so both ends of the window say their year.
    await expect(page.getByText(/^From [A-Z][a-z]{2} \d{1,2}, 20\d\d to [A-Z][a-z]{2} \d{1,2}, 20\d\d, without PayPal’s fees\.$/)).toBeVisible();
    // The demo's history holds both kinds of row: a bill with its letter stored, and pay for work done before the agreement was signed.
    await expect(page.getByText(packet.lookback.status.documented).locator("visible=true").first()).toBeVisible();
    await expect(page.getByText(packet.lookback.reasons.before_agreement).locator("visible=true").first()).toBeVisible();
    await maybeScreenshot(page, "packet");
    await expectNoHorizontalOverflow(page);
  });

  test(`the care agreements screen fits at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await page.goto("/dashboard/circle/care-agreements");
    await expect(page.getByRole("heading", { level: 1, name: agreements.title })).toBeVisible();
    await expect(page.getByText(agreements.status.active)).toBeVisible();
    await maybeScreenshot(page, "care-agreements");
    await expectNoHorizontalOverflow(page);
  });
}

test("one click downloads a ZIP with the PDF, the spreadsheets and the verifiable record", async ({ page }) => {
  await startDemo(page);
  await page.goto("/dashboard/record/packet");
  const href = await page.getByRole("link", { name: packet.download }).getAttribute("href");
  const reply = await page.request.get(href ?? "");
  expect(reply.ok()).toBe(true);
  expect(reply.headers()["content-type"]).toBe("application/zip");
  expect(reply.headers()["content-disposition"]).toMatch(/kin-care-packet-\d{4}-\d{2}-\d{2}\.zip/);
  const bytes = await reply.body();
  // A ZIP starts with a local file header, and every file the README promises is named in it.
  expect(bytes.subarray(0, 4).toString("hex")).toBe("504b0304");
  const text = bytes.toString("latin1");
  for (const name of ["packet.pdf", "care-agreements.txt", "look-back.csv", "visit-proofs.csv", "paypal-payments.csv", "record/kin-record.json", "README.txt", "manifest.json"]) expect(text).toContain(name);
});

test("an organizer writes a care agreement for a caregiver and reads it before saving", async ({ page }) => {
  await startDemo(page);
  await page.goto("/dashboard/circle/care-agreements");
  await page.getByLabel(agreements.form.duties).fill("Prepare meals\nDrive to the clinic");
  await page.getByRole("button", { name: agreements.form.review }).click();
  await expect(page.getByText(agreements.form.previewTitle)).toBeVisible();
  await expect(page.getByText("1. Prepare meals")).toBeVisible();
  await page.getByRole("button", { name: agreements.form.back }).click();
  await expect(page.getByText(agreements.form.previewTitle)).toHaveCount(0);
});

test("Kin will not draft an agreement with a spouse", async ({ page }) => {
  await startDemo(page);
  await page.goto("/dashboard/circle/care-agreements");
  await page.getByLabel(agreements.form.relation).selectOption("spouse");
  await expect(page.getByText(agreements.form.spouseWarning)).toBeVisible();
  await expect(page.getByRole("button", { name: agreements.form.review })).toBeDisabled();
});

// A long German label must wrap on a phone, never push the page sideways.
for (const path of ["/de/dashboard/record/packet", "/de/dashboard/circle/care-agreements", "/fr/dashboard/circle/care-agreements"]) {
  test(`${path} fits a 360 pixel phone in a language with long words`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await startDemo(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
