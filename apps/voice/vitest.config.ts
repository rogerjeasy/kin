import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The call tests run against a migrated PostgreSQL in Docker, like @kin/db's.
    globalSetup: ["@kin/db/testing/global-setup"],
    hookTimeout: 90_000,
    testTimeout: 30_000,
  },
});
