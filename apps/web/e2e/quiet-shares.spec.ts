import { expect, test, type Locator, type Page } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { maybeScreenshot } from "./support/screenshot";
import { laptop, viewports } from "./support/viewports";

const copy = english.dashboard.quietShares;
const fill = (template: string, values: Record<string, string>) => template.replaceAll(/\{(\w+)\}/g, (_, name: string) => values[name] ?? "");
const phone = (page: Page, name: string): Locator => page.getByRole("region", { name: fill(copy.family.phone, { name }) });

/** One person tells their own Kin what they can give, checks the draft and seals it, on their own phone. */
async function answerOn(screen: Locator, words: string, expectedMonthly: string): Promise<void> {
  await screen.getByLabel(copy.chat.label).fill(words);
  await screen.getByRole("button", { name: copy.chat.send }).click();
  await expect(screen.getByText(/written that down/)).toBeVisible();
  await expect(screen.getByLabel(copy.offer.monthly)).toHaveValue(expectedMonthly);
  await screen.getByRole("button", { name: copy.offer.seal }).click();
}

for (const viewport of viewports) {
  test(`quiet shares and the family side by side fit at ${viewport.width}×${viewport.height}, with the stairlift waiting`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    // The overview says the stairlift is waiting for two answers.
    await expect(page.getByText("Stairlift repair, $900.00: 1 of 3 have answered.")).toBeVisible();
    await page.getByRole("link", { name: copy.card.open }).click();
    await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stairlift repair" })).toBeVisible();
    await expect(page.getByText(fill(copy.answered, { answered: "1", asked: "3" }))).toBeVisible();
    await expect(page.getByText(copy.offer.sealedTitle)).toBeVisible();
    await expect(page.getByText("Only you can read it: $300.00 now.")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await maybeScreenshot(page, "quiet-shares");

    await page.getByRole("link", { name: copy.family.link }).click();
    await expect(page.getByRole("heading", { level: 1, name: copy.family.title })).toBeVisible();
    for (const name of ["Marcus", "Elena", "Ana"]) await expect(phone(page, name)).toBeVisible();
    await expect(phone(page, "Marcus").getByRole("heading", { name: copy.chat.title })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await maybeScreenshot(page, "quiet-shares-family");
  });
}

test("the stairlift lands quietly: Marcus $540, Elena $300, Ana $60 and two drives, and only Ana is told her limit stayed private", async ({ page }) => {
  await page.setViewportSize({ width: laptop.width, height: laptop.height });
  await startDemo(page);
  await page.goto("/dashboard/fairness/quiet-shares/family");

  await answerOn(phone(page, "Marcus"), "I can cover more this time, up to 600.", "600.00");
  await expect(phone(page, "Marcus").getByText(copy.offer.sealedTitle)).toBeVisible();
  await expect(phone(page, "Elena").getByText(fill(copy.answered, { answered: "2", asked: "3" }))).toBeVisible();

  await answerOn(phone(page, "Ana"), "Honestly I can only manage 60. I can drive Rose to her two appointments, about 3 hours.", "60.00");
  const parts = { Marcus: "$540.00", Elena: "$300.00", Ana: "$60.00" } as const;
  for (const [name, amount] of Object.entries(parts)) {
    const screen = phone(page, name);
    await expect(screen.getByText(copy.part.title, { exact: true })).toBeVisible();
    await expect(screen.getByText(amount, { exact: true })).toBeVisible();
    await expect(screen.getByText("of $900.00 for the family")).toBeVisible();
  }
  await expect(phone(page, "Ana").getByText(fill(copy.part.care, { count: "2" }))).toBeVisible();
  await expect(phone(page, "Ana").getByText(copy.part.private)).toBeVisible();
  // Nobody else is told anyone's limit, or sees anyone else's part.
  for (const name of ["Marcus", "Elena"]) {
    await expect(phone(page, name).getByText(copy.part.private)).toHaveCount(0);
    await expect(phone(page, name).getByText("$60.00")).toHaveCount(0);
  }
  await expect(phone(page, "Ana").getByText("$540.00")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await maybeScreenshot(page, "quiet-shares-plan");

  for (const name of ["Ana", "Marcus", "Elena"]) await phone(page, name).getByRole("button", { name: copy.part.accept }).click();
  for (const name of ["Ana", "Marcus", "Elena"]) await expect(phone(page, name).getByText(copy.part.agreedTitle)).toBeVisible();
  await expect(phone(page, "Ana").getByText(fill(copy.part.simulated.checkout, { amount: "$60.00" }))).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await maybeScreenshot(page, "quiet-shares-agreed");
});

test("a short ask says only how much is short and is spread over three months, and an organizer asks the family for a new cost", async ({ page }) => {
  await startDemo(page);
  // The stairlift, with offers that cannot cover it: the family hears only the gap.
  await page.goto("/dashboard/fairness/quiet-shares/family");
  await answerOn(phone(page, "Marcus"), "I can cover more this time, up to 400.", "400.00");
  await answerOn(phone(page, "Ana"), "Honestly I can only manage 60.", "60.00");
  for (const name of ["Marcus", "Elena", "Ana"]) await expect(phone(page, name).getByText(fill(copy.short.title, { shortfall: "$140.00" }))).toBeVisible();
  await expect(phone(page, "Elena").getByText(fill(copy.short.spreadCovers, { months: "3" }))).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await phone(page, "Elena").getByRole("button", { name: fill(copy.short.spread, { months: "3" }) }).click();
  await expect(phone(page, "Ana").getByText(copy.part.title, { exact: true })).toBeVisible();
  await expect(phone(page, "Ana").getByText("$180.00", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/dashboard/fairness/quiet-shares");
  await page.getByLabel(copy.raise.titleLabel).fill("New hearing aids");
  await page.getByLabel(copy.raise.amountLabel).fill("1200");
  await page.getByRole("button", { name: copy.raise.submit }).click();
  await expect(page.getByRole("heading", { name: "New hearing aids" })).toBeVisible();
  await expect(page.getByText(fill(copy.answered, { answered: "0", asked: "3" }))).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("an observer sees the family's progress and nothing to answer, and a caregiver is not shown it", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Daniel");
  await page.goto("/dashboard/fairness/quiet-shares");
  await expect(page.getByRole("heading", { name: "Stairlift repair" })).toBeVisible();
  await expect(page.getByText(copy.readOnly)).toBeVisible();
  await expect(page.getByRole("heading", { name: copy.chat.title })).toHaveCount(0);
  await expect(page.getByText(copy.offer.sealedTitle)).toHaveCount(0);
  await expect(page.getByRole("button", { name: copy.raise.submit })).toHaveCount(0);

  await seatAs(page, "Amara");
  await page.goto("/dashboard/fairness/quiet-shares");
  await expect(page.getByRole("heading", { name: "Stairlift repair" })).toHaveCount(0);
});
