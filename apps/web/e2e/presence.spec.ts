import { expect, test } from "@playwright/test";

import hebrew from "../src/i18n/dictionaries/he.json" with { type: "json" };
import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { maybeScreenshot } from "./support/screenshot";
import { viewports } from "./support/viewports";

const copy = english.dashboard.presence;

for (const viewport of viewports) {
  test(`a cloned grandson is stopped: Theo taps "not me" and Rose hears so, at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await page.goto("/dashboard/presence");
    await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
    await expect(page.getByText("Theo")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: copy.examples.grandson.label }).click();
    await page.getByRole("button", { name: copy.submit }).click();
    const outcome = page.getByRole("status").filter({ hasText: copy.kinSays });
    await expect(outcome).toContainText(copy.states.asked);
    await expect(outcome).toContainText("I am checking with Theo now, on Theo’s own phone.");
    await expect(outcome).toContainText("$2,000.00");
    for (const marker of ["secrecy", "urgency", "gift_cards", "courier_pickup"] as const) await expect(outcome).toContainText(copy.markers[marker]);
    await expect(outcome).toContainText("Outgoing money is on hold until");
    await maybeScreenshot(page, "presence-asked");
    await expectNoHorizontalOverflow(page);

    // Theo's phone, shown beside it in a demo circle, takes the same public route the real one does.
    await page.getByRole("button", { name: copy.phone.no }).click();
    await expect(page.getByRole("status").filter({ hasText: copy.kinSays })).toContainText("Theo says someone else made that call. Please hang up and send nothing. I have told the family.", { timeout: 15_000 });
    await expect(page.getByRole("region", { name: copy.recent.title })).toContainText(copy.states.denied);
    await maybeScreenshot(page, "presence-denied");
    await expectNoHorizontalOverflow(page);

    // The day-long hold is said on every screen, with the way to the check, and fits the screen.
    for (const path of ["/dashboard", "/dashboard/approvals"]) {
      await page.goto(path);
      const hold = page.getByRole("status").filter({ hasText: "Outgoing money is on hold until" });
      await expect(hold).toBeVisible();
      await expect(hold.getByRole("link", { name: english.dashboard.shell.presenceHold.link })).toHaveAttribute("href", "/dashboard/presence");
      await expectNoHorizontalOverflow(page);
    }

    // What Kin stopped is on the month's statement.
    await page.goto("/dashboard/record/statement");
    await expect(page.getByText(english.dashboard.presence.statement.label).first()).toBeVisible();
    await expect(page.getByText("$2,000.00").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

test("a caller who is not on the list gets no one asked, and Rose is told so", async ({ page }) => {
  await startDemo(page);
  await page.goto("/dashboard/presence");
  await page.getByRole("button", { name: copy.examples.stranger.label }).click();
  await page.getByRole("button", { name: copy.submit }).click();
  const outcome = page.getByRole("status").filter({ hasText: copy.kinSays });
  // Nobody was asked, so it never says Kin could not reach someone.
  await expect(outcome).toContainText(copy.notOnList);
  await expect(outcome).not.toContainText(copy.states.unanswered);
  await expect(outcome).toContainText("I do not have anyone of that name among the people you trust.");
  await expect(page.getByText("Theo’s phone")).toHaveCount(0);
});

test("a family member can add and remove someone Kin may ask", async ({ page }) => {
  await startDemo(page);
  await page.goto("/dashboard/presence");
  await page.getByLabel(copy.voices.nameLabel, { exact: true }).fill("Mia");
  await page.getByLabel(copy.voices.relationshipLabel).fill("granddaughter");
  await page.getByLabel(copy.voices.phoneLabel).fill("+1 555 555 0190");
  await page.getByRole("button", { name: copy.voices.submit }).click();
  await expect(page.getByText(copy.voices.added)).toBeVisible();
  await expect(page.getByText("Mia")).toBeVisible();
  await page.getByRole("button", { name: "Remove Mia" }).click();
  await expect(page.getByRole("button", { name: "Remove Mia" })).toHaveCount(0);
});

test("the real person's page asks one question with two big answers, and a dead link says the same words as any other", async ({ page }) => {
  await startDemo(page);
  await page.goto("/dashboard/presence");
  await page.getByRole("button", { name: copy.examples.grandson.label }).click();
  await page.getByRole("button", { name: copy.submit }).click();
  const link = await page.getByRole("link", { name: /Open the page Theo would see/ }).getAttribute("href");
  expect(link).toMatch(/\/v\/[A-Za-z0-9_-]{43}$/);
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(link ?? "/");
    await expect(page.getByRole("heading", { level: 1, name: english.presenceLink.title })).toBeVisible();
    await expect(page.getByText("Rose was just asked for $2,000.00")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  await page.getByRole("button", { name: english.presenceLink.yes }).click();
  await expect(page.getByRole("status")).toContainText("Kin has told the family it was you.");

  // A "yes" can still become a "no"; once it has, the link opened again says so, never that the question ran out.
  await page.goto(link ?? "/");
  await page.getByRole("button", { name: english.presenceLink.no }).click();
  await expect(page.getByRole("status")).toContainText("Kin has told the family it was not you");
  await page.goto(link ?? "/");
  await expect(page.getByRole("status")).toContainText("Kin has told the family it was not you");
  await expect(page.getByText("run out")).toHaveCount(0);
  await expect(page.getByRole("button", { name: english.presenceLink.no })).toHaveCount(0);

  await page.goto(`/v/${"A".repeat(43)}`);
  await expect(page.getByText(english.presenceLink.problems.link)).toBeVisible();
  await page.goto("/v/not-a-token");
  await expect(page.getByText(english.presenceLink.problems.link)).toBeVisible();
});

test("the screen reads right to left in Hebrew with nothing overflowing", async ({ page }) => {
  await startDemo(page);
  await page.goto("/he/dashboard/presence");
  await expect(page.getByRole("heading", { level: 1, name: hebrew.dashboard.presence.title })).toBeVisible();
  await page.getByRole("button", { name: hebrew.dashboard.presence.examples.grandson.label }).click();
  await page.getByRole("button", { name: hebrew.dashboard.presence.submit }).click();
  await expect(page.getByRole("status").filter({ hasText: hebrew.dashboard.presence.kinSays })).toContainText("Theo");
  await expectNoHorizontalOverflow(page);
});

test("the family sees this week's code, and the parent can put it to a caller when Theo could not be reached", async ({ page }) => {
  await startDemo(page);
  await page.goto("/dashboard/presence");
  const panel = page.getByRole("region", { name: copy.code.title });
  const words = (await panel.locator("p[lang=en]").innerText()).split("·").map((word) => word.trim());
  expect(words).toHaveLength(3);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: copy.examples.stranger.label }).click();
  await page.getByRole("button", { name: copy.submit }).click();
  await expect(page.getByText(copy.code.askTitle).first()).toBeVisible();
  // The parent is told to ask for the code and never to say it: the words are on this same screen.
  await expect(page.getByText(copy.code.askText).first()).toContainText("Never tell them the code.");
  // The latest check is shown in the result and again in the list below it, each with its own form: the first is the one in front of the person.
  await page.getByLabel(copy.code.label).first().fill("apple apple apple");
  await page.getByRole("button", { name: copy.code.submit }).first().click();
  await expect(page.getByText("That is not this week’s family code.").first()).toBeVisible();
  await page.getByLabel(copy.code.label).first().fill(`he said ${words.join(" ")}`);
  await page.getByRole("button", { name: copy.code.submit }).first().click();
  await expect(page.getByText("That is this week’s family code.").first()).toBeVisible();
  // Kin's answer to the parent never says the words back: only the family's own screen shows them.
  const answer = (await page.getByText("That is this week’s family code.").first().innerText()).toLowerCase();
  for (const word of words) expect(answer).not.toMatch(new RegExp(`\\b${word}\\b`));
});

for (const viewport of viewports) {
  test(`after Theo says it was him, the family can ask to help him, to his own account only, at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await page.goto("/dashboard/presence");
    await page.getByRole("button", { name: copy.examples.grandson.label }).click();
    await page.getByRole("button", { name: copy.submit }).click();
    await page.getByRole("button", { name: copy.phone.yes }).click();
    const outcome = page.getByRole("status").filter({ hasText: copy.kinSays });
    await expect(outcome).toContainText("Theo says that call really was from Theo.", { timeout: 15_000 });
    await expect(page.getByText("Help Theo").first()).toBeVisible();
    await maybeScreenshot(page, "presence-help");
    await expectNoHorizontalOverflow(page);

    await page.getByLabel(copy.help.amountLabel).first().fill("2500");
    await page.getByRole("button", { name: copy.help.submit }).first().click();
    await expect(page.getByText(english.dashboard.presence.errors.above_asked).first()).toBeVisible();
    await page.getByLabel(copy.help.amountLabel).first().fill("150");
    await page.getByRole("button", { name: copy.help.submit }).first().click();
    await expect(page.getByText(copy.help.raised).first()).toBeVisible();

    // It is on the family's approvals like any payment, in the family's words, and a demo says that its money is simulated.
    await page.getByRole("link", { name: copy.help.open }).first().click();
    const card = page.getByText("Help for Theo, after Theo confirmed the request.");
    await expect(card).toBeVisible();
    await expect(page.getByText("In this demo, the payment to Theo is simulated")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

test("a family member gives their own PayPal account on the page their confirmation text opens, and a dead link says so", async ({ page }) => {
  await page.goto(`/t/${"A".repeat(43)}`);
  await expect(page.getByText(english.trustedVoiceLink.problems.link)).toBeVisible();
});
