import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // cdk.out holds a copy of the repository for the web image. Its tests are not these.
    include: ["src/**/*.test.ts"],
    // Each test synthesizes the whole app, which takes seconds when the machine is busy.
    testTimeout: 30_000,
  },
});
