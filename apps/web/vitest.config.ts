import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright owns e2e/. Vitest runs the unit tests beside the code.
    include: ["src/**/*.test.ts"],
  },
});
