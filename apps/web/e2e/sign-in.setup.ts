import { expect, test as setup } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { SIGNED_IN_STATE } from "./support/signed-in-state";

// Signs in once through the real flow, and keeps the session for the
// dashboard tests.
setup("sign in", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("link", { name: english.signInPage.form.submit }).click();

  await expect(page).toHaveURL("/dashboard");
  await page.context().storageState({ path: SIGNED_IN_STATE });
});
