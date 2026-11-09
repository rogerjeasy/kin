import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { dashboardRoutes, shiftDoorRoute } from "../src/content/dashboard-routes";
import arabic from "../src/i18n/dictionaries/ar.json" with { type: "json" };
import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import hebrew from "../src/i18n/dictionaries/he.json" with { type: "json" };
import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { E2E_APP_ORIGIN } from "./support/ports";
import { maybeScreenshot } from "./support/screenshot";
import { phone, viewports } from "./support/viewports";

const check = english.checkLink;
const links = english.dashboard.shiftLinks;
const calls = english.dashboard.shiftCalls;
const door = english.dashboard.shiftDoor;
const shifts = english.dashboard.shifts;
const SHIFTS = dashboardRoutes.shifts;
const PERMISSIONS = "/dashboard/circle/shifts";
const NUMBER = "+16505550177";

const octet = () => 1 + Math.floor(Math.random() * 253);
/** A caller of its own for each browser, as the load balancer would give one, so the per-address limit sees each test apart. */
const callerHeaders = () => ({ "x-forwarded-for": `198.51.${octet()}.${octet()}` });
/** The words that say a link did not work. The framework's own route announcer is an alert too, so the message is asked for by its text. */
const problem = (page: Page, words: string): Locator => page.getByRole("alert").filter({ hasText: words });

/** A browser with no cookies and no sign-in: a caregiver's phone, opening a link from a text. */
async function strangersPhone(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: E2E_APP_ORIGIN, extraHTTPHeaders: callerHeaders() });
  expect(await context.cookies()).toEqual([]);
  return { context, page: await context.newPage() };
}

const dayCare = (page: Page): Locator => page.locator("li[id^='shift-']").filter({ hasText: "Day care" });

/** Makes a check-in link for Amara's shift from the family's screen, and returns the address shown once. */
async function makeLink(page: Page): Promise<string> {
  await page.goto(SHIFTS);
  const card = dayCare(page);
  await card.getByRole("button", { name: links.open }).click();
  const panel = card.getByRole("group", { name: /^Check-in link for Amara/ });
  await panel.getByRole("button", { name: links.make }).click();
  const address = await panel.getByLabel(links.linkLabel).inputValue();
  expect(address).toMatch(new RegExp(`^${E2E_APP_ORIGIN}/c/[A-Za-z0-9_-]{43}$`));
  return address;
}

test.describe("a check-in link, opened with nobody signed in", () => {
  test("lets a caregiver check in and out from a text, and the family's card follows", async ({ page, browser }) => {
    await startDemo(page);
    const address = await makeLink(page);
    const panel = dayCare(page).getByRole("group", { name: /^Check-in link for Amara/ });
    await expect(panel.getByRole("img", { name: links.qrLabel })).toBeVisible();
    await expect(panel).toContainText(links.once);
    // No text can be sent here: Twilio is not set, and the panel says so instead of showing a button that fails.
    await expect(panel).toContainText(links.textingOff);
    await expect(panel.getByRole("button", { name: links.send })).toHaveCount(0);
    await maybeScreenshot(page, "shift-link-panel");

    const stranger = await strangersPhone(browser);
    const response = await stranger.page.goto(address);
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response?.headers()["cache-control"]).toBe("no-store");
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    await expect(stranger.page.getByRole("heading", { level: 1, name: check.title })).toBeVisible();
    await expect(stranger.page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    // Before any tap the page already names the caregiver, gives the planned time and offers the one key that fits.
    await expect(stranger.page.getByText("Hello, Amara.")).toBeVisible();
    await expect(stranger.page.getByText(/^Planned visit: \d{1,2}:\d{2}\s[AP]M to \d{1,2}:\d{2}\s[AP]M\.$/)).toBeVisible();
    await expect(stranger.page.getByRole("button", { name: check.checkIn })).toBeVisible();
    await expect(stranger.page.getByRole("button", { name: check.checkOut })).toHaveCount(0);
    await maybeScreenshot(stranger.page, "check-link");

    await stranger.page.getByRole("button", { name: check.checkIn }).click();
    await expect(stranger.page.getByRole("status")).toContainText(/^Checked in at \d{1,2}:\d{2}\s[AP]M\. Thank you, Amara\./);
    await expect(stranger.page.getByRole("status")).toContainText("Planned visit:");
    // The one key is now the other one.
    await expect(stranger.page.getByRole("button", { name: check.checkIn })).toHaveCount(0);
    await stranger.page.getByRole("button", { name: check.checkOut }).click();
    await expect(stranger.page.getByRole("status")).toContainText(/Checked out at .*The family will be told\./);
    await expect(stranger.page.getByRole("button", { name: /Check (in|out)/ })).toHaveCount(0);
    await maybeScreenshot(stranger.page, "check-link-done");
    // Opened again, the page knows both keys have turned and offers none.
    await stranger.page.reload();
    await expect(stranger.page.getByText("This visit is finished. Thank you, Amara.")).toBeVisible();
    await expect(stranger.page.getByRole("button", { name: /Check (in|out)/ })).toHaveCount(0);
    // Still no cookie: the link was the only credential.
    expect(await stranger.context.cookies()).toEqual([]);
    await stranger.context.close();

    await page.reload();
    await expect(dayCare(page)).toContainText(shifts.chips.checked_out);
    await expect(dayCare(page)).toContainText("Waiting for Rose’s word");
  });

  test("says only that a link is not valid, for garbage, a made-up token and a token that is too short", async ({ browser }) => {
    const stranger = await strangersPhone(browser);
    // Looks like a token, is not one: the database refuses it and the page says the same generic words, with no key to press.
    await stranger.page.goto(`/c/${"Z".repeat(43)}`);
    await expect(problem(stranger.page, check.problems.link)).toBeVisible();
    await expect(stranger.page.getByRole("button", { name: /Check (in|out)/ })).toHaveCount(0);
    await expect(stranger.page.getByText("Hello,")).toHaveCount(0);
    // Cannot be a token: said at once, with no button to press.
    await stranger.page.goto("/c/not-a-token");
    await expect(problem(stranger.page, check.problems.link)).toBeVisible();
    await expect(stranger.page.getByRole("button", { name: /Check (in|out)/ })).toHaveCount(0);
    await stranger.context.close();
  });

  test("tells the page's first look the same for a token that never existed as for one that cannot be one, and slows one address", async ({ playwright }) => {
    const caller = await playwright.request.newContext({ baseURL: E2E_APP_ORIGIN, extraHTTPHeaders: callerHeaders() });
    const words = async (path: string) => (await (await caller.get(path)).text()).includes(check.problems.link);
    expect([await words(`/c/${"Y".repeat(43)}`), await words("/c/short")]).toEqual([true, true]);
    let last = "";
    for (let each = 0; each < 24; each += 1) last = await (await caller.get(`/c/${"X".repeat(43)}`)).text();
    expect(last).toContain(check.problems.busy);
    expect(last).not.toContain(check.problems.link);
    await caller.dispose();
  });

  test("answers the route the same way for a token that never existed and for a body that is no tap, and slows one address", async ({ playwright }) => {
    const caller = await playwright.request.newContext({ baseURL: E2E_APP_ORIGIN, extraHTTPHeaders: { ...callerHeaders(), origin: "https://elsewhere.example" } });
    const made = await caller.post("/api/check-link", { data: { token: "Y".repeat(43), action: "in" } });
    const malformed = await caller.post("/api/check-link", { data: { token: "short", action: "in" } });
    expect([made.status(), malformed.status()]).toEqual([403, 400]);
    expect(await made.json()).toEqual({ ok: false, reason: "link" });
    expect(await malformed.json()).toEqual({ ok: false, reason: "link" });
    expect(made.headers()["cache-control"]).toBe("no-store");
    const statuses: number[] = [];
    for (let each = 0; each < 24; each += 1) statuses.push((await caller.post("/api/check-link", { data: { token: "X".repeat(43), action: "out" } })).status());
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(3);
    await caller.dispose();
  });
});

test.describe("the door tag", () => {
  test("prints one page with a code that opens the shifts and nothing secret, for the family who run the calendar", async ({ page }) => {
    await startDemo(page);
    await page.goto(SHIFTS);
    await page.getByRole("link", { name: door.link }).click();
    await expect(page).toHaveURL(shiftDoorRoute);
    await expect(page.getByRole("heading", { level: 1, name: door.title })).toBeVisible();
    const card = page.getByRole("article");
    await expect(card.getByRole("img", { name: door.qrLabel })).toBeVisible();
    await expect(card).toContainText(`${E2E_APP_ORIGIN}/dashboard/shifts`);
    // Nothing secret and nothing about money or people.
    await expect(card).not.toContainText(/\/c\/|Rose|Amara|\$/);
    await maybeScreenshot(page, "shift-door");

    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("button", { name: door.print })).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: door.title })).toBeHidden();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(card).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const pdf = await page.pdf({ format: "A4", printBackground: false });
    expect(pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)?.length).toBe(1);
  });

  test("is not shown to a caregiver or an observer, who are sent back to the shifts", async ({ page }) => {
    await startDemo(page);
    for (const persona of ["Amara", "Daniel"]) {
      await seatAs(page, persona);
      await page.goto(shiftDoorRoute);
      await expect(page).toHaveURL(SHIFTS);
      await expect(page.getByRole("link", { name: door.link })).toHaveCount(0);
    }
    await seatAs(page, "Rose");
    await page.goto(SHIFTS);
    await expect(page.getByRole("link", { name: door.link })).toBeVisible();
  });
});

test.describe("Kin's phone call to the parent", () => {
  const panel = (page: Page) => page.getByRole("region", { name: calls.settings.title });

  test("needs the number and the parent's agreement, shows who agreed, never shows the number again, and is switched off in one tap", async ({ page }) => {
    await startDemo(page);
    await page.goto(PERMISSIONS);
    await expect(panel(page)).toContainText(calls.settings.notSet);
    await expect(panel(page)).toContainText("never calls from 21:00 to 08:00");
    await expect(panel(page)).toContainText("at most twice");
    await expect(panel(page)).toContainText("This is the demo, so you play Rose’s part");
    await panel(page).getByLabel(calls.settings.phone).fill(NUMBER);
    // Without ticking the agreement, nothing is sent.
    let sent = false;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/shifts") && request.method() === "POST") sent = true;
    });
    await panel(page).getByRole("button", { name: calls.settings.enable }).click();
    expect(sent).toBe(false);
    await panel(page).getByRole("checkbox", { name: /I agree that Kin, an automated assistant/ }).check();
    await maybeScreenshot(page, "shift-call-settings");
    await panel(page).getByRole("button", { name: calls.settings.enable }).click();
    await expect(panel(page).getByRole("status")).toHaveText(calls.settings.saved);
    await expect(panel(page)).toContainText(calls.settings.on);
    await expect(panel(page)).toContainText(/^[\s\S]*agreed on /);
    await expect(panel(page).getByLabel(calls.settings.phone)).toHaveValue("");
    await expect(page.locator("body")).not.toContainText("6505550177");
    await page.reload();
    await expect(page.locator("body")).not.toContainText("6505550177");
    await expect(panel(page)).toContainText(calls.settings.on);

    await panel(page).getByRole("button", { name: calls.settings.disable }).click();
    await expect(panel(page).getByRole("status")).toHaveText(calls.settings.stopped);
    await expect(panel(page)).toContainText(calls.settings.off);
  });

  test("lets a contributor switch the call off but not on, and keeps it from a caregiver", async ({ page }) => {
    await startDemo(page);
    await seatAs(page, "Marcus");
    await page.goto(PERMISSIONS);
    await expect(panel(page).getByRole("button", { name: calls.settings.enable })).toHaveCount(0);
    await expect(panel(page)).toContainText("Only Rose can switch the call on");
    await expect(panel(page).getByRole("button", { name: calls.settings.disable })).toBeVisible();
    await seatAs(page, "Amara");
    await page.goto(PERMISSIONS);
    await expect(page).toHaveURL(SHIFTS);
  });
});

test.describe("Kin's simulated call", () => {
  /** Amara taps in and out, so the shift waits for Rose's word. */
  async function amaraFinishesTheVisit(page: Page) {
    await seatAs(page, "Amara");
    await page.goto(SHIFTS);
    await page.getByRole("button", { name: shifts.needs.checkIn }).click();
    await page.getByRole("button", { name: shifts.needs.checkOut }).click();
    await expect(page.getByRole("status").filter({ hasText: "Rose’s word" })).toBeVisible();
  }

  test("plays what a real call says, labelled simulated, and a press of 1 records Rose's yes through the real two keys", async ({ page }) => {
    await startDemo(page);
    // Before the visit has ended there is no call to hear.
    await seatAs(page, "Rose");
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: calls.simulator.open })).toHaveCount(0);
    await amaraFinishesTheVisit(page);
    await seatAs(page, "Rose");
    await page.goto("/dashboard");
    await page.route("**/api/speech/say", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, reason: "speech_unavailable" }) }));
    await page.getByRole("button", { name: calls.simulator.open }).click();
    const call = page.getByRole("region", { name: /^Kin’s call to Rose/ });
    await expect(call).toContainText(calls.simulator.badge);
    await expect(call).toContainText("This is Kin, an automated assistant for your family.");
    await expect(call).toContainText(/Was Amara with you this (morning|afternoon|evening)\? Say yes, or press 1\. Say no, or press 2\./);
    await maybeScreenshot(page, "shift-call-simulator");
    // The words are the call's own, and if Kin cannot speak they stay on the screen.
    await call.getByRole("button", { name: calls.simulator.play }).click();
    await expect(call.getByRole("status")).toContainText(calls.simulator.listenFailed);

    await call.getByRole("button", { name: calls.simulator.yes }).click();
    await expect(page.getByRole("status").filter({ hasText: "$44.00 is approved by Rose’s standing permission" })).toBeVisible();
  });

  test("closes without recording anything when the key for no is pressed, and shows on the family's card too", async ({ page }) => {
    await startDemo(page);
    await amaraFinishesTheVisit(page);
    await seatAs(page, "Rose");
    await page.goto(SHIFTS);
    await expect(dayCare(page).getByRole("button", { name: calls.simulator.open })).toBeVisible();
    await dayCare(page).getByRole("button", { name: calls.simulator.open }).click();
    await page.getByRole("button", { name: calls.simulator.no }).click();
    await expect(page.getByRole("region", { name: /^Kin’s call to Rose/ })).toHaveCount(0);
    await page.reload();
    await expect(dayCare(page)).toContainText(shifts.chips.checked_out);
    await expect(dayCare(page)).not.toContainText(shifts.chips.confirmed);
    // Seen by Amara, the call does not exist at all.
    await seatAs(page, "Amara");
    await page.goto(SHIFTS);
    await expect(page.getByRole("button", { name: calls.simulator.open })).toHaveCount(0);
  });
});

test.describe("the venmo note on where the pay goes", () => {
  test("says in the demo that a Venmo payment is simulated, and only when Venmo is chosen", async ({ page }) => {
    await startDemo(page);
    await seatAs(page, "Amara");
    await page.goto(SHIFTS);
    const form = page.getByRole("region", { name: shifts.target.title });
    await expect(form.getByRole("note")).toHaveCount(0);
    await form.getByLabel(shifts.target.wallet).selectOption("venmo");
    await expect(form.getByRole("note")).toHaveText(shifts.target.venmoSimulated);
    await form.getByLabel(shifts.target.wallet).selectOption("paypal");
    await expect(form.getByRole("note")).toHaveCount(0);
  });
});

for (const viewport of viewports) {
  test.describe(`the new screens at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("fit, in English, Arabic and Hebrew: the link page, the link panel, the door tag and the call settings", async ({ page, browser }) => {
      await startDemo(page);
      await page.goto(SHIFTS);
      await dayCare(page).getByRole("button", { name: links.open }).click();
      await dayCare(page).getByRole("button", { name: links.make }).click();
      await expect(dayCare(page).getByRole("img", { name: links.qrLabel })).toBeVisible();
      const live = (await dayCare(page).getByLabel(links.linkLabel).inputValue()).split("/c/")[1] ?? "";
      expect(live).toMatch(/^[A-Za-z0-9_-]{43}$/);
      await expectNoHorizontalOverflow(page);
      await page.goto(`/ar${SHIFTS}`);
      await dayCare(page).getByRole("button", { name: arabic.dashboard.shiftLinks.open }).click();
      await dayCare(page).getByRole("button", { name: arabic.dashboard.shiftLinks.make }).click();
      await expect(dayCare(page).getByRole("img", { name: arabic.dashboard.shiftLinks.qrLabel })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      for (const [path, heading] of [
        [shiftDoorRoute, door.title],
        [`/ar${shiftDoorRoute}`, arabic.dashboard.shiftDoor.title],
        [`/he${shiftDoorRoute}`, hebrew.dashboard.shiftDoor.title],
        [PERMISSIONS, english.dashboard.shiftPermissions.title],
        [`/ar${PERMISSIONS}`, arabic.dashboard.shiftPermissions.title],
        [`/he${PERMISSIONS}`, hebrew.dashboard.shiftPermissions.title],
      ] as const) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }

      const stranger = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, baseURL: E2E_APP_ORIGIN, extraHTTPHeaders: callerHeaders() });
      const phonePage = await stranger.newPage();
      for (const [path, copy] of [
        ["", check],
        ["/ar", arabic.checkLink],
        ["/he", hebrew.checkLink],
      ] as const) {
        // A live link: the name, the planned time and the one key, which stays at least 56 pixels tall.
        await phonePage.goto(`${path}/c/${live}`);
        await expect(phonePage.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
        await expect(phonePage.getByRole("button", { name: copy.checkIn })).toBeVisible();
        await expect(phonePage.getByRole("button", { name: copy.checkOut })).toHaveCount(0);
        await expect(phonePage.getByText("Amara").first()).toBeVisible();
        await expectNoHorizontalOverflow(phonePage);
        const box = await phonePage.getByRole("button", { name: copy.checkIn }).boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);
        // A dead one: the generic words, large, and nothing to press.
        await phonePage.goto(`${path}/c/${"Q".repeat(43)}`);
        await expect(phonePage.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
        await expect(phonePage.locator("p[role=alert]")).toBeVisible();
        await expect(phonePage.getByRole("button", { name: copy.checkIn })).toHaveCount(0);
        await expectNoHorizontalOverflow(phonePage);
      }
      await expect(phonePage.locator("html")).toHaveAttribute("dir", "rtl");
      await stranger.close();
    });
  });
}

test("the link page works by keyboard alone", async ({ page, browser }) => {
  await startDemo(page);
  const address = await makeLink(page);
  const stranger = await strangersPhone(browser);
  await stranger.page.setViewportSize({ width: phone.width, height: phone.height });
  await stranger.page.goto(address);
  const checkIn = stranger.page.getByRole("button", { name: check.checkIn });
  await checkIn.focus();
  await expect(checkIn).toBeFocused();
  await stranger.page.keyboard.press("Enter");
  await expect(stranger.page.getByRole("status")).toContainText("Checked in at");
  const checkOut = stranger.page.getByRole("button", { name: check.checkOut });
  await checkOut.focus();
  await expect(checkOut).toBeFocused();
  await stranger.page.keyboard.press("Enter");
  await expect(stranger.page.getByRole("status")).toContainText("Checked out at");
  await stranger.context.close();
});
