import { readFileSync } from "node:fs";

import { expect, test, type Page, type Route } from "@playwright/test";

import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { viewports } from "./support/viewports";

// Chromium's fake microphone: Speak and Stop record a real (synthetic) signal.
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] }, permissions: ["microphone"] });

const SPOKEN = readFileSync(new URL("./fixtures/spoken.mp3", import.meta.url));

/**
 * Answers the speech routes in the browser, as Amazon Transcribe and Polly
 * would through the server, and keeps what was sent. The server's own
 * speech logic is tested against fakes in src/server/speech-actions.test.ts.
 */
async function standInForSpeech(page: Page, transcripts: { transcript: string; answer: "yes" | "no" | "unclear" }[], answers: { decision: string; outcome: string }[] = []) {
  const sent: { route: string; bytes: number; body: string | null }[] = [];
  await page.route("**/api/speech/transcribe**", async (route: Route) => {
    sent.push({ route: "transcribe", bytes: route.request().postDataBuffer()?.byteLength ?? 0, body: null });
    await route.fulfill({ json: { ok: true, ...transcripts.shift() } });
  });
  await page.route("**/api/speech/say", async (route: Route) => {
    sent.push({ route: "say", bytes: 0, body: route.request().postData() });
    await route.fulfill({ body: SPOKEN, contentType: "audio/mpeg" });
  });
  await page.route("**/api/speech/answer**", async (route: Route) => {
    sent.push({ route: route.request().url(), bytes: route.request().postDataBuffer()?.byteLength ?? 0, body: null });
    await route.fulfill({ json: { ok: true, ...answers.shift() } });
  });
  return sent;
}

async function record(page: Page, scope: ReturnType<Page["getByRole"]>, label: string) {
  await scope.getByRole("button", { name: label }).click();
  await expect(scope.getByText("Listening. Press Stop when you have finished.")).toBeVisible();
  await page.waitForTimeout(600);
  await scope.getByRole("button", { name: "Stop" }).click();
}

async function configureAmara(page: Page) {
  await page.goto("/dashboard/circle");
  const setup = page.getByRole("region", { name: "Caregiver rates" });
  await setup.getByLabel("Hourly rate").fill("22.00");
  await setup.getByRole("button", { name: "Save rate" }).click();
  await expect(setup.getByRole("status")).toContainText("Rate saved");
}

for (const viewport of viewports) {
  test(`a caregiver speaks their visits, hears the bill, and submits it with a spoken yes at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const sent = await standInForSpeech(page, [{ transcript: "Yesterday 4 hours with Rose.", answer: "unclear" }, { transcript: "Yes, submit it.", answer: "yes" }]);
    await startDemo(page);
    await configureAmara(page);
    await seatAs(page, "Amara");
    await page.goto("/dashboard/bills");
    const form = page.getByRole("region", { name: "Bill for your visits" });

    await record(page, form, "Speak your visits");
    await expect(form.getByLabel("Or describe your visits in your own words")).toHaveValue("Yesterday 4 hours with Rose.");
    await form.getByRole("button", { name: "Fill in the days" }).click();
    await expect(form.getByLabel("Hours", { exact: true })).toHaveValue("4");
    await form.getByRole("button", { name: "Review bill" }).click();
    await expect(form).toContainText("$88.00");
    await expectNoHorizontalOverflow(page);

    await form.getByRole("button", { name: "Hear the bill" }).click();
    await record(page, form, "Answer by voice");
    await expect(page.getByRole("status").filter({ hasText: "Bill submitted" })).toBeVisible();

    // Audio went up as whole 16-bit samples; the read-back asked for the reviewed details, never words.
    const recordings = sent.filter((each) => each.route === "transcribe");
    expect(recordings).toHaveLength(2);
    for (const each of recordings) expect(each.bytes > 0 && each.bytes % 2 === 0).toBe(true);
    const said = JSON.parse(sent.find((each) => each.route === "say")?.body ?? "{}") as Record<string, unknown>;
    expect(Object.keys(said).toSorted()).toEqual(["details", "kind", "locale"]);
  });
}

test("a spoken no sends the caregiver back to change the visits", async ({ page }) => {
  await standInForSpeech(page, [{ transcript: "No, wait.", answer: "no" }]);
  await startDemo(page);
  await configureAmara(page);
  await seatAs(page, "Amara");
  await page.goto("/dashboard/bills");
  const form = page.getByRole("region", { name: "Bill for your visits" });
  await form.getByLabel("Service date").fill("2026-10-01");
  await form.getByLabel("Hours", { exact: true }).fill("3");
  await form.getByRole("button", { name: "Review bill" }).click();
  await record(page, form, "Answer by voice");
  await expect(form.getByRole("button", { name: "Review bill" })).toBeVisible();
  await expect(form.getByLabel("Hours", { exact: true })).toHaveValue("3");
});

test("Rose answers a proposal by voice, and it is recorded only after she confirms", async ({ page }) => {
  const sent = await standInForSpeech(page, [], [{ decision: "approve", outcome: "heard" }, { decision: "approve", outcome: "approved" }]);
  await startDemo(page);
  await seatAs(page, "Rose");
  await page.goto("/dashboard/approvals");
  // Pinned by its ID: once Kin has heard the answer, the card's buttons change.
  const id = await page.getByRole("article").filter({ has: page.getByRole("button", { name: "Hear it and answer by voice" }) }).first().getAttribute("id");
  const card = page.locator(`[id="${id}"]`);
  await card.getByRole("button", { name: "Hear it and answer by voice" }).click();
  await record(page, card, "Speak");
  await expect(card.getByText("Kin heard yes. Listen, then confirm by voice.")).toBeVisible();
  await record(page, card, "Confirm by voice");
  await expect(card.getByRole("status")).toContainText("Approved.");
  const steps = sent.filter((each) => each.route.includes("/api/speech/answer")).map((each) => new URL(each.route).searchParams.get("step"));
  expect(steps).toEqual(["answer", "confirm"]);
  await expectNoHorizontalOverflow(page);
});
