import { expect, test } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import french from "../src/i18n/dictionaries/fr.json" with { type: "json" };
import { fill } from "../src/i18n/template";
import { laptop } from "./support/viewports";

type Spoken = { text: string; lang: string };

declare global {
  interface Window {
    spoken: Spoken[];
  }
}

test.use({ viewport: { width: laptop.width, height: laptop.height } });

// Stand in for the browser's voice, so the test hears exactly what would be said.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.spoken = [];
    class FakeUtterance extends EventTarget {
      lang = "";
      onend: (() => void) | null = null;
      constructor(public text: string) {
        super();
      }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance });
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        speak: (utterance: FakeUtterance) => window.spoken.push({ text: utterance.text, lang: utterance.lang }),
        cancel: () => undefined,
      },
    });
  });
});

test("the play button says the sentence Rose hears, amount included", async ({ page }) => {
  await page.goto("/");
  const { hero } = english.home;

  await page.getByRole("button", { name: hero.play }).click();

  expect(await page.evaluate(() => window.spoken)).toEqual([
    { text: fill(hero.spoken, { amount: hero.spokenAmount }), lang: "en" },
  ]);
  await expect(page.getByRole("button", { name: hero.stop })).toBeVisible();
});

test("on the French page it speaks French", async ({ page }) => {
  await page.goto("/fr");
  const { hero } = french.home;

  await page.getByRole("button", { name: hero.play }).click();

  expect(await page.evaluate(() => window.spoken)).toEqual([
    { text: fill(hero.spoken, { amount: hero.spokenAmount }), lang: "fr" },
  ]);
});
