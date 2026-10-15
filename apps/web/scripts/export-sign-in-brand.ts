import { mkdirSync, writeFileSync } from "node:fs";

import { SIGN_IN_BRAND_DIRECTORY, signInBrandFiles } from "./sign-in-brand-files.ts";

/**
 * Writes the branding of Cognito's sign-in pages into the infrastructure,
 * which deploys it: `pnpm --filter @kin/web run brand:export`. A test fails
 * when the committed files and the generator disagree.
 */
mkdirSync(SIGN_IN_BRAND_DIRECTORY, { recursive: true });
for (const [name, svg] of Object.entries(signInBrandFiles())) {
  writeFileSync(new URL(name, SIGN_IN_BRAND_DIRECTORY), `${svg}\n`);
}
console.log(`Wrote ${Object.keys(signInBrandFiles()).length} files to ${SIGN_IN_BRAND_DIRECTORY.pathname}`);
