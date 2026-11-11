import { expect, test, type Page } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { payPurseAs } from "./support/pay-purse";
import { maybeScreenshot } from "./support/screenshot";
import { viewports } from "./support/viewports";

const copy = english.dashboard.purse;
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, slot: string) => values[slot] ?? `{${slot}}`);

/** The ID of the newest payment row on her list, which its element ID carries. */
async function newestPaymentId(page: Page): Promise<string> {
  const id = await page.locator('li[id^="purse-payment-"]').first().getAttribute("id");
  if (id === null) throw new Error("No Purse payment on the screen");
  return id.slice("purse-payment-".length);
}

async function ask(page: Page, example: keyof typeof copy.ask.examples) {
  await page.getByRole("button", { name: copy.ask.examples[example].label }).click();
  await page.getByRole("button", { name: copy.ask.submit }).click();
}

for (const viewport of viewports) {
  test(`Rose sends Lily a birthday gift on her word alone, a pressured request is held and the family stops it, at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await seatAs(page, "Rose");
    await page.goto("/dashboard");

    // Rose's overview offers her Purse, in her own words.
    await expect(page.getByRole("region", { name: copy.card.titleMine })).toContainText("$50.00");
    await page.getByRole("link", { name: copy.card.linkMine }).click();
    await expect(page).toHaveURL("/dashboard/purse");
    await expect(page.getByRole("heading", { level: 1, name: copy.mineTitle })).toBeVisible();
    await expect(page.getByRole("region", { name: copy.balance.labelMine })).toContainText("$50.00");
    await expectNoHorizontalOverflow(page);

    // "Send Lily 25 dollars for her birthday." Kin reads it back; her yes is the approval, and nobody else is asked.
    await ask(page, "gift");
    const readBack = page.getByRole("region", { name: copy.confirm.title });
    await expect(readBack).toContainText("Send Lily $25.00 for her birthday, from your Purse?");
    await maybeScreenshot(page, "purse-read-back");
    await expectNoHorizontalOverflow(page);
    await readBack.getByRole("button", { name: copy.confirm.yes }).click();
    await expect(page.getByRole("status").filter({ hasText: "on its way to Lily" })).toContainText("$25.00");

    // The worker pays it, simulated in a demo, and her list says sent.
    const lily = page.locator('li[id^="purse-payment-"]').filter({ hasText: "Lily" });
    await expect(lily).toContainText(copy.states.approved);
    expect(await payPurseAs(await newestPaymentId(page))).toBe(1);
    await page.reload();
    await expect(lily).toContainText(copy.states.paid);
    await expect(lily).toContainText(copy.payments.simulated);
    await expect(lily).toContainText(copy.payments.sealed);
    await expect(page.getByRole("region", { name: copy.balance.labelMine })).toContainText("$25.00");
    // What her family sees: the amount and day in the record, and never who or why.
    const sees = page.getByRole("region", { name: copy.familySees.title });
    await expect(sees).toContainText("$25.00 from the Purse");
    await expect(sees).toContainText(copy.familySees.never);
    await expect(sees).not.toContainText("Lily");
    await maybeScreenshot(page, "purse-sent");
    await expectNoHorizontalOverflow(page);

    // A caller presses her: a stranger, gift cards, five hundred dollars. Kin holds it and asks her gently.
    await page.getByRole("button", { name: copy.ask.examples.scam.label }).click();
    await page.getByRole("button", { name: copy.ask.submit }).click();
    const held = page.getByRole("region", { name: copy.confirm.title });
    await expect(held).toContainText("Send the man from the bank $500.00? Kin will wait a day before it goes, and tell your family.");
    await expect(held).toContainText(copy.confirm.question);
    await expect(held).toContainText(fill(copy.reasons.new_payee, { payee: "the man from the bank" }));
    await expect(held).toContainText(copy.reasons.risky_route);
    await maybeScreenshot(page, "purse-held-question");
    await expectNoHorizontalOverflow(page);
    await held.getByRole("button", { name: copy.confirm.ownIdea }).click();
    await expect(page.getByRole("status").filter({ hasText: "is not in your address book" })).toBeVisible();

    // Elena sees the Purse's ceiling, balance and month's total, the alert and the hold, and never the Lily line.
    await seatAs(page, "Elena");
    await page.goto("/dashboard");
    await expect(page.getByRole("region", { name: fill(copy.card.title, { parent: "Rose" }) })).toContainText(fill(copy.card.heldOne, { count: "1", parent: "Rose" }));
    await page.goto("/dashboard/purse");
    await expect(page.getByRole("heading", { level: 1, name: fill(copy.title, { parent: "Rose" }) })).toBeVisible();
    const alert = page.getByRole("region", { name: copy.alerts.title });
    await expect(alert).toContainText(fill(copy.alerts.text, { parent: "Rose", amount: "$500.00", payee: "the man from the bank" }));
    await expect(page.getByText(copy.summary.balance.label, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("$25.00").first()).toBeVisible();
    await expect(page.getByText(fill(copy.summary.month.one, { count: "1" }))).toBeVisible();
    const shared = page.getByRole("region", { name: fill(copy.payments.titleFamily, { parent: "Rose" }) });
    await expect(shared).toContainText(fill(copy.payments.emptyFamily, { parent: "Rose" }));
    await expect(page.getByText("for her birthday")).toHaveCount(0);
    await maybeScreenshot(page, "purse-family-alert");
    await expectNoHorizontalOverflow(page);

    await alert.getByRole("button", { name: new RegExp(`^${copy.alerts.cancel}`) }).click();
    await expect(shared).toContainText(fill(copy.payments.stoppedBy, { name: "Elena" }));
    await expect(page.getByRole("region", { name: copy.alerts.title })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
}

test("Rose can share a payment with her family, and the observer then sees it", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Rose");
  await page.goto("/dashboard/purse");
  await ask(page, "church");
  await page.getByRole("region", { name: copy.confirm.title }).getByRole("button", { name: copy.confirm.yes }).click();
  await expect(page.getByRole("status").filter({ hasText: "on its way to St. Mary's Church" })).toBeVisible();
  const church = page.locator('li[id^="purse-payment-"]').filter({ hasText: "St. Mary's Church" });
  await church.getByRole("button", { name: new RegExp(`^${copy.payments.share}`) }).click();
  await expect(church).toContainText(copy.payments.shared);

  await seatAs(page, "Daniel");
  await page.goto("/dashboard/purse");
  const shared = page.getByRole("region", { name: fill(copy.payments.titleFamily, { parent: "Rose" }) });
  await expect(shared).toContainText("St. Mary's Church");
  await expect(shared).toContainText("$10.00");
  // An observer reads and never writes: no setup, no verifying, no stopping.
  await expect(page.getByRole("button", { name: copy.setup.submit })).toHaveCount(0);
  await expect(page.getByRole("button", { name: copy.book.verify })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("the family verifies Sam once, and a caregiver never reaches the Purse", async ({ page }) => {
  await startDemo(page);
  await page.goto("/dashboard/purse");
  const book = page.getByRole("region", { name: copy.book.title });
  const sam = book.getByRole("listitem").filter({ hasText: "Sam" });
  await expect(sam).toContainText(copy.book.waiting);
  await sam.getByRole("button", { name: fill(copy.book.verifyLabel, { name: "Sam" }) }).click();
  await expect(sam).toContainText(fill(copy.book.verified, { name: "Elena" }));

  await seatAs(page, "Amara");
  await page.goto("/dashboard/purse");
  await expect(page).not.toHaveURL("/dashboard/purse");
  await expect(page.getByRole("heading", { level: 1, name: copy.mineTitle })).toHaveCount(0);
});

test("Rose asks Ask Kin to send Lily a gift: it is read back and waits for her yes on her Purse", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Rose");
  await page.goto("/dashboard/ask");
  await page.getByRole("textbox", { name: english.askKin.form.label }).fill("Send Lily 25 dollars for her birthday");
  await page.getByRole("button", { name: english.askKin.form.ask, exact: true }).click();
  const proposal = page.getByRole("region", { name: english.askKin.purseProposal.title });
  await expect(proposal).toBeVisible();
  await expect(proposal.getByRole("link", { name: english.askKin.purseProposal.link })).toHaveAttribute("href", "/dashboard/purse");
  await expectNoHorizontalOverflow(page);
});
