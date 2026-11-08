import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The inbox tests run against a migrated PostgreSQL in Docker, like @kin/db's.
    globalSetup: ["@kin/db/testing/global-setup"],
    hookTimeout: 90_000,
    testTimeout: 30_000,
    // Every file shares one PostgreSQL, and a payout loop leases outbox messages of every circle, so a
    // file running beside another can pay the other's payout and make its assertion see "gone".
    fileParallelism: false,
  },
});
