import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // The same "@/" the app's tsconfig gives its source.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    // Playwright owns e2e/. Vitest runs the unit tests beside the code.
    include: ["src/**/*.test.ts"],
  },
});
