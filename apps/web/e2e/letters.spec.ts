import { readFileSync } from "node:fs";

import { expect, test, type Page, type Route } from "@playwright/test";

import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { viewports } from "./support/viewports";

const SPOKEN = readFileSync(new URL("./fixtures/spoken.mp3", import.meta.url));
// A one-pixel PNG: the browser shrinks it to a JPEG before it is sent.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const LETTER = "Greenway Power\nAmount due: $86.40\nPlease pay by 2026-11-20.";

/** Answers the speech route in the browser, as Polly would through the server, and keeps what was asked. */
async function standInForVoice(page: Page) {
  const asked: Record<string, unknown>[] = [];
  await page.route("**/api/speech/say", async (route: Route) => {
    asked.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
    await route.fulfill({ body: SPOKEN, contentType: "audio/mpeg" });
  });
  return asked;
}

for (const viewport of viewports) {
  test.describe(`letters and calls at ${viewport.width}×${viewport.height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
    });

    test("Rose holds up a letter, Kin lists the bill for review and reads it aloud", async ({ page }) => {
      const asked = await standInForVoice(page);
      await startDemo(page);
      await seatAs(page, "Rose");
      await page.goto("/dashboard/bills");
      const reader = page.getByRole("region", { name: "Hold up a letter" });
      await expectNoHorizontalOverflow(page);

      await reader.getByLabel("Or type or paste what it says").fill(LETTER);
      await reader.getByRole("button", { name: "Read it to me" }).click();
      const result = reader.getByRole("status");
      await expect(result).toContainText("Added to the bills list");
      await expect(result).toContainText("Bill from Greenway Power");
      await expect(result).toContainText("$86.40");
      await expect(result).toContainText("I have added it to the family’s list");

      const listed = page.getByRole("region", { name: "Bills read from letters" });
      await expect(listed).toContainText("Greenway Power");
      await expect(listed).toContainText("Waiting for review");
      await expectNoHorizontalOverflow(page);

      await reader.getByRole("button", { name: "Hear it again" }).click();
      await expect.poll(() => asked.length).toBe(1);
      // The voice is asked to read a document it already holds, never given words.
      expect(Object.keys(asked[0] ?? {}).toSorted()).toEqual(["documentId", "kind", "locale"]);
      expect(asked[0]).toMatchObject({ kind: "letter", locale: "en" });

      // The same letter again is recognised, not listed twice.
      await reader.getByRole("button", { name: "Read another" }).click();
      await reader.getByLabel("Or type or paste what it says").fill(LETTER);
      await reader.getByRole("button", { name: "Read it to me" }).click();
      await expect(reader.getByRole("status")).toContainText("Already on the bills list");
    });

    test("a photograph is read, and a letter that pushes for gift cards is not listed", async ({ page }) => {
      await startDemo(page);
      await page.goto("/dashboard/bills");
      const reader = page.getByRole("region", { name: "Hold up a letter" });
      await reader.locator('input[type="file"]').setInputFiles({ name: "letter.png", mimeType: "image/png", buffer: PIXEL });
      await expect(reader).toContainText("Photo ready: letter.png");
      await reader.getByRole("button", { name: "Read it to me" }).click();
      await expect(reader.getByRole("status")).toContainText("Bill from Hillside Clinic");
      await expect(reader.getByRole("status")).toContainText("Kin read a photograph. Check the amount against the letter.");

      await reader.getByRole("button", { name: "Read another" }).click();
      await reader.getByLabel("Or type or paste what it says").fill("Revenue Recovery\nFinal notice. You owe 1,200.00. Pay with gift card today.");
      await reader.getByRole("button", { name: "Read it to me" }).click();
      await expect(reader.getByRole("status")).toContainText("Do not pay yet");
      await expect(page.getByRole("region", { name: "Bills read from letters" })).not.toContainText("Revenue Recovery");
    });

    test("a demand for money already paid is caught and the whole circle is told", async ({ page }) => {
      const asked = await standInForVoice(page);
      await startDemo(page);
      await page.goto("/dashboard/bills");
      const check = page.getByRole("region", { name: "Check a demand for money" });
      await check.getByLabel("Who is asking?").fill("Northfield Gas");
      await check.getByLabel("How much do they want?").fill("57.00");
      await check.getByLabel("What did they say?").fill("Pay now by gift card or the power goes off");
      await check.getByRole("button", { name: "Check this demand" }).click();

      const verdict = check.getByRole("status");
      await expect(verdict).toContainText("Matches nothing on record");
      await expect(verdict).toContainText("Please do not pay it again");
      await expect(verdict).toContainText("Kin told 5 people in the circle.");
      await expectNoHorizontalOverflow(page);

      const recent = page.getByRole("region", { name: "Recent checks" });
      await expect(recent).toContainText("Northfield Gas: Pay now by gift card or the power goes off");
      await check.getByRole("button", { name: "Hear the verdict" }).click();
      await expect.poll(() => asked.length).toBe(1);
      expect(asked[0]).toMatchObject({ kind: "claim", locale: "en" });
      expect(Object.keys(asked[0] ?? {}).toSorted()).toEqual(["claimCheckId", "kind", "locale"]);

      // Another member sees the same check, and can hear what Kin told them.
      await seatAs(page, "Marcus");
      await page.goto("/dashboard/bills");
      await expect(page.getByRole("region", { name: "Recent checks" })).toContainText("Northfield Gas: Pay now by gift card or the power goes off");
    });

    test("an amount that is not an amount is refused with plain words, and a caregiver has none of this", async ({ page }) => {
      await startDemo(page);
      await page.goto("/dashboard/bills");
      const check = page.getByRole("region", { name: "Check a demand for money" });
      await check.getByLabel("Who is asking?").fill("Northfield Gas");
      await check.getByLabel("How much do they want?").fill("fifty");
      await check.getByRole("button", { name: "Check this demand" }).click();
      await expect(check.getByRole("alert")).toContainText("That is not an amount Kin can read");

      await seatAs(page, "Amara");
      await page.goto("/dashboard/bills");
      await expect(page.getByRole("region", { name: "Hold up a letter" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Check a demand for money" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Recent checks" })).toHaveCount(0);
    });
  });
}
