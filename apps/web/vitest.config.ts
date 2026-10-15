import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // The same "@/" the app's tsconfig gives its source.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    // Playwright owns e2e/. Vitest runs the unit tests beside the code.
    include: ["src/**/*.test.ts"],
    // The circle's screens are tested against a real, migrated PostgreSQL
    // with a provisioned demo circle, as the app reads it.
    globalSetup: [fileURLToPath(import.meta.resolve("@kin/db/testing/global-setup"))],
    hookTimeout: 90_000,
    testTimeout: 30_000,
  },
});
