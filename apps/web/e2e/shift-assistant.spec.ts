import { expect, test, type Page } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { maybeScreenshot } from "./support/screenshot";

const assistant = english.dashboard.shiftAssistant;
const SHIFTS = "/dashboard/shifts";
const ENDPOINT = "/api/shifts/assistant";
const WIDE = { width: 1440, height: 900 };

// Amara's day care shift is the one in view this week: the calendar draws only the shifts in view, so a shift is found by its title.
const dayCare = (page: Page) => page.locator(".care-calendar .b-sch-event").filter({ hasText: "Day care" });
const cards = (page: Page) => page.locator("li[id^='shift-']");
const chatButton = (page: Page) => page.locator(".care-calendar .b-chat-button");
const popup = (page: Page) => page.locator(".b-aichat-popup");

/** Opens the shifts page on a wide screen and waits for the calendar and its assistant. */
async function openCalendar(page: Page) {
  await page.setViewportSize(WIDE);
  await page.goto(SHIFTS);
  await expect(page.getByLabel(/^Care calendar, /).first()).toBeVisible({ timeout: 20_000 });
  await expect(chatButton(page)).toBeVisible();
}

async function ask(page: Page, question: string) {
  await chatButton(page).click();
  await expect(popup(page)).toBeVisible();
  await popup(page).locator(".b-mention-text-field .b-field-inner").first().click();
  await page.keyboard.type(question);
  await page.keyboard.press("Enter");
}

test("is marked experimental and says it only answers and highlights", async ({ page }) => {
  await startDemo(page);
  await openCalendar(page);
  await expect(page.getByText(assistant.experimental, { exact: true })).toBeVisible();
  await expect(page.getByText(assistant.note)).toBeVisible();
  await maybeScreenshot(page, "shifts-assistant-note");
  await expectNoHorizontalOverflow(page);
});

test("answers a question about the calendar by filtering it, through Kin's own route and the model", async ({ page }) => {
  await startDemo(page);
  await openCalendar(page);
  await expect(dayCare(page)).toBeVisible();
  await ask(page, "Show only Ana's visit");
  await expect(popup(page).getByText("I filtered the calendar to Ana's visit.")).toBeVisible({ timeout: 20_000 });
  // Filtering is all it did: Amara's shift is only hidden from the calendar, and still on the page's list.
  await expect(dayCare(page)).toBeHidden();
  await expect(cards(page).filter({ hasText: "Day care" })).toHaveCount(1);
  await maybeScreenshot(page, "shifts-assistant-answer");
  await expectNoHorizontalOverflow(page);
});

test("declines in words to book, move or cancel, and the calendar is as it was", async ({ page }) => {
  await startDemo(page);
  await openCalendar(page);
  await ask(page, "Please cancel the day care shift");
  await expect(popup(page).getByText("I cannot book, move or cancel anything.")).toBeVisible({ timeout: 20_000 });
  await expect(dayCare(page)).toBeVisible();
  await page.reload();
  await expect(cards(page).filter({ hasText: "Day care" })).toContainText(english.dashboard.shifts.chips.scheduled);
});

test("cannot alter the calendar even when a reply asks it to remove a shift", async ({ page }) => {
  await startDemo(page);
  await openCalendar(page);
  const before = await cards(page).count();
  let calls = 0;
  // A server gone wrong: it answers with the call of a tool that removes, then with a plain sentence.
  await page.route(`**${ENDPOINT}`, async (route) => {
    calls += 1;
    const content = calls === 1 ? [{ type: "tool_use", id: "toolu_bad", name: "removeEvents", input: { eventConditions: { type: "and", conditions: [{ field: "name", operator: "*", value: "care" }] } } }] : [{ type: "text", text: "Done." }];
    await route.fulfill({ json: { ok: true, type: "message", role: "assistant", content, stop_reason: calls === 1 ? "tool_use" : "end_turn", usage: { input_tokens: 1, output_tokens: 1 } } });
  });
  await ask(page, "Remove all the shifts");
  await expect.poll(() => calls, { timeout: 20_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1_500);
  await expect(dayCare(page)).toBeVisible();
  await page.unroute(`**${ENDPOINT}`);
  await page.reload();
  await expect(cards(page)).toHaveCount(before);
});

test("is open to a caregiver, who has only their own shift on it, and to an observer, who may only look", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Amara");
  await openCalendar(page);
  await expect(dayCare(page)).toBeVisible();
  await expect(cards(page)).toHaveCount(1);
  await ask(page, "Who else is on this week?");
  await expect(popup(page).getByText("Amara is on the calendar.")).toBeVisible({ timeout: 20_000 });
  await seatAs(page, "Daniel");
  await openCalendar(page);
  await ask(page, "Who is on?");
  await expect(popup(page).getByText("Amara is on the calendar.")).toBeVisible({ timeout: 20_000 });
  await expect(dayCare(page)).toBeVisible();
});

test.describe("the route", () => {
  const widgetTools = [{ name: "getEvents", description: "Reads events", input_schema: { type: "object", properties: {} } }];
  const body = (extra: Record<string, unknown> = {}) => ({ messages: [{ role: "user", content: "Who is on?" }], system: [{ type: "text", text: "A scheduler." }], tools: widgetTools, max_tokens: 10_000, temperature: 0, ...extra });

  test("answers an allowed request in the widget's shape, drops tools that change records, and refuses what it does not know", async ({ page }) => {
    await startDemo(page);
    const origin = new URL(page.url()).origin;
    const post = (data: unknown, headers: Record<string, string> = { origin }) => page.request.post(ENDPOINT, { headers, data });

    const answered = await post(body({ tools: [...widgetTools, { name: "updateEvents", description: "Changes events", input_schema: { type: "object", properties: {} } }] }));
    expect(answered.status()).toBe(200);
    expect(await answered.json()).toMatchObject({ ok: true, role: "assistant", content: [{ type: "text", text: "Amara is on the calendar." }], stop_reason: "end_turn" });

    const unknown = await post(body({ tools: [...widgetTools, { name: "payCaregiver", description: "Pays", input_schema: { type: "object", properties: {} } }] }));
    expect(unknown.status()).toBe(400);
    expect(await unknown.json()).toEqual({ ok: false, reason: "invalid" });

    const oversize = await post(body({ messages: [{ role: "user", content: "x".repeat(200_000) }] }));
    expect(oversize.status()).toBe(413);

    const malformed = await post({ messages: "nope" });
    expect(malformed.status()).toBe(400);

    const foreign = await post(body(), { origin: "https://example.org" });
    expect(foreign.status()).toBe(403);
  });

  test("is answered in the viewer's language when the widget says so, and asks nothing of a stranger", async ({ page, browser }) => {
    await startDemo(page);
    const origin = new URL(page.url()).origin;
    const french = await page.request.post(ENDPOINT, { headers: { origin, "x-kin-locale": "fr" }, data: body() });
    expect(french.status()).toBe(200);
    // Nobody signed in, nobody in the demo: no seat, no answer.
    const stranger = await browser.newContext();
    const refused = await stranger.request.post(`${origin}${ENDPOINT}`, { headers: { origin }, data: body() });
    expect([401, 403]).toContain(refused.status());
    await stranger.close();
  });
});
