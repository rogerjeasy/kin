import { defineConfig, devices } from "@playwright/test";

import { IDENTITY_PROVIDER } from "./e2e/support/identity-provider";
import { SIGNED_IN_STATE } from "./e2e/support/signed-in-state";

const port = 3100;
const baseURL = `http://localhost:${port}`;
const identityProvider = `http://localhost:${IDENTITY_PROVIDER.port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  // Signing in crosses two servers and renders a signed-in page from cold.
  expect: { timeout: 10_000 },
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    // Public pages, and every test of signing in, start signed out.
    { name: "public", testIgnore: [/dashboard\.spec\.ts/, /\.setup\.ts/], use: { ...devices["Desktop Chrome"] } },
    { name: "sign-in", testMatch: /\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "signed-in",
      testMatch: /dashboard\.spec\.ts/,
      dependencies: ["sign-in"],
      use: { ...devices["Desktop Chrome"], storageState: SIGNED_IN_STATE },
    },
  ],
  // The tests run against the production build, the same thing a visitor gets.
  // The test:e2e script builds first. Each server is started as one process,
  // with no package-manager wrapper, so Playwright can stop it cleanly.
  webServer: [
    {
      // A stand-in for Cognito that runs the same sign-in flow (e2e/support).
      command: "node e2e/support/identity-provider.ts",
      url: `${identityProvider}/health`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      command: `node node_modules/next/dist/bin/next start --port ${port}`,
      url: baseURL,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      timeout: 60_000,
      env: {
        KIN_AUTH_ISSUER: identityProvider,
        KIN_AUTH_LOGIN_URL: identityProvider,
        KIN_AUTH_CLIENT_ID: IDENTITY_PROVIDER.clientId,
        KIN_WEB_ORIGIN: baseURL,
      },
    },
  ],
});
