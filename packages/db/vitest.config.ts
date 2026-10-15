import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/testing/global-setup.ts"],
    // Starting PostgreSQL and migrating it takes a few seconds.
    hookTimeout: 90_000,
    testTimeout: 30_000,
  },
});
