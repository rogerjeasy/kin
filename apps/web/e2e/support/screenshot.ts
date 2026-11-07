import type { Page } from "@playwright/test";

/**
 * Saves a full-page picture when KIN_SCREENSHOT_DIR is set, so a person can look
 * at the screen. Does nothing in a normal run.
 */
export async function maybeScreenshot(page: Page, name: string): Promise<void> {
  const directory = process.env.KIN_SCREENSHOT_DIR;
  if (directory === undefined || directory === "") return;
  const width = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: `${directory}/${name}-${width}.png`, fullPage: true });
}
