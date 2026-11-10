import { expect, test } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { maybeScreenshot } from "./support/screenshot";
import { viewports } from "./support/viewports";

const copy = english.askKin;
/** DEMO_QUESTIONS in apps/web/src/server/ask-kin/demo-questions.ts; repeated because that module reads the server session. */
const QUESTIONS = 10;

for (const viewport of viewports) {
  test(`a visitor asks Kin from the overview and sees how Kin found the answer, at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    const card = page.getByRole("region", { name: copy.card.title });
    await expect(card).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await card.getByRole("link", { name: "Has Amara been paid?" }).click();
    await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
    await expect(page.getByLabel(copy.form.label)).toHaveValue("Has Amara been paid?");
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: copy.form.ask }).click();
    await expect(page.getByText("Kin read the record for you.")).toBeVisible();
    await expect(page.getByText(/^Written by Claude/)).toBeVisible();
    await expect(page.getByText(copy.answer.trace)).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: copy.tools.get_paypal_payout_status })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

test("a suggestion asks at once, and a reorder shows the proposal waiting for a yes", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Rose");
  await page.goto("/dashboard/ask");
  await page.getByRole("button", { name: "Reorder Rose's refill" }).click();
  await expect(page.getByText(copy.proposal.text)).toBeVisible();
  await expect(page.getByRole("link", { name: copy.proposal.link })).toHaveAttribute("href", "/dashboard/approvals");
  await expect(page.getByRole("listitem").filter({ hasText: copy.tools.propose_refill })).toBeVisible();
});

test("a caregiver can ask, and is offered only what concerns their own pay", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Amara");
  await page.goto("/dashboard/ask");
  await expect(page.getByRole("button", { name: copy.suggestions.owes })).toHaveCount(0);
  await page.getByLabel(copy.form.label).fill("Who owes whom this month?");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Kin cannot show that from your seat.")).toBeVisible();
  await expect(page.getByText(copy.answer.traceEmpty)).toBeVisible();
});

test("a demo visitor has ten questions, sees what is left, and is then invited to start a circle", async ({ page }) => {
  await startDemo(page);
  await page.goto("/dashboard/ask");
  const status = page.getByRole("status").filter({ hasText: "questions left in this demo" });
  await expect(status).toHaveText(`${QUESTIONS} of ${QUESTIONS} questions left in this demo`);

  const box = page.getByLabel(copy.form.label);
  for (let asked = 1; asked <= QUESTIONS; asked += 1) {
    await box.fill(`Has Amara been paid? (${asked})`);
    await page.getByRole("button", { name: copy.form.ask }).click();
    await expect(page.getByText("Kin read the record for you.")).toBeVisible();
    if (asked < QUESTIONS) await expect(status).toHaveText(`${QUESTIONS - asked} of ${QUESTIONS} questions left in this demo`);
  }

  // The last question opens a window: sign up or sign in to keep asking, or stay in the demo.
  const dialog = page.getByRole("dialog", { name: `You have asked this demo's ${QUESTIONS} questions` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(copy.demoLimit.text);
  await expect(dialog.getByRole("link", { name: copy.demoLimit.signUp })).toHaveAttribute("href", "/start");
  await expect(dialog.getByRole("link", { name: english.common.nav.signIn })).toHaveAttribute("href", "/sign-in");
  await expectNoHorizontalOverflow(page);
  await maybeScreenshot(page, "ask-kin-demo-limit-window");
  await dialog.getByRole("button", { name: copy.demoLimit.stay }).click();
  await expect(dialog).toHaveCount(0);

  // The last answer stays on screen; the question box gives way to the same invitation.
  await expect(page.getByText("Kin read the record for you.")).toBeVisible();
  const limit = page.getByRole("region", { name: `You have asked this demo's ${QUESTIONS} questions` });
  await expect(limit).toBeVisible();
  await expect(box).toHaveCount(0);
  await expect(limit.getByRole("link", { name: copy.demoLimit.signUp })).toHaveAttribute("href", "/start");
  await expect(limit.getByRole("link", { name: english.common.nav.signIn })).toHaveAttribute("href", "/sign-in");
  await expectNoHorizontalOverflow(page);
  await maybeScreenshot(page, "ask-kin-demo-limit-card");

  // The server is what holds the limit: one more question sent straight to it is refused.
  const sixth = await page.request.post("/api/ask-kin", { data: { question: "Has Amara been paid?", locale: "en" }, headers: { origin: new URL(page.url()).origin } });
  expect(await sixth.json()).toEqual({ ok: false, reason: "demo_limit" });

  // And it holds across a reload, where the invitation waits without interrupting.
  await page.reload();
  await expect(page.getByRole("region", { name: `You have asked this demo's ${QUESTIONS} questions` })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the window for the last demo question fits a 320 pixel phone and closes with Escape", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await startDemo(page);
  await page.goto("/dashboard/ask");
  const box = page.getByLabel(copy.form.label);
  for (let asked = 1; asked <= QUESTIONS; asked += 1) {
    await box.fill(`Has Amara been paid? (${asked})`);
    await page.getByRole("button", { name: copy.form.ask }).click();
    await expect(page.getByRole("button", { name: copy.form.asking })).toHaveCount(0);
  }
  const dialog = page.getByRole("dialog", { name: `You have asked this demo's ${QUESTIONS} questions` });
  await expect(dialog).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await maybeScreenshot(page, "ask-kin-demo-limit-window");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
