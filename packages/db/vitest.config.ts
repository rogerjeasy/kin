import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/testing/global-setup.ts"],
    // Starting PostgreSQL and migrating it takes a few seconds.
    hookTimeout: 90_000,
    testTimeout: 30_000,
    // Every file shares one PostgreSQL. The money-rule tests truncate tables to prove it is refused, which
    // locks the tables that reference them before the refusal, and that deadlocks with a file writing to them.
    fileParallelism: false,
  },
});
