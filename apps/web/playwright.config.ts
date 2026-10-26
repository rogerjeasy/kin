import { randomBytes } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

import { E2E_DATABASE, e2eDatabaseEnv } from "./e2e/support/database-settings";
import { IDENTITY_PROVIDER } from "./e2e/support/identity-provider";
import { MODEL_STAND_IN } from "./e2e/support/model-stand-in";
import { SIGNED_IN_STATE } from "./e2e/support/signed-in-state";

const port = 3100;
const baseURL = `http://localhost:${port}`;
const identityProvider = `http://localhost:${IDENTITY_PROVIDER.port}`;
// Read once, in the process that starts the servers, so both get the same
// passwords. Playwright loads this file again in each test worker; the
// workers inherit the first draw through the environment, so a test that
// seeds the database reaches the same one.
const database = sharedDatabaseEnv();
const ADMIN_ONLY = new Set(["KIN_DATABASE_ADMIN_USER", "KIN_DATABASE_ADMIN_PASSWORD", "KIN_DATABASE_SERVICE_PASSWORD"]);
// Signs demo visitors' sessions for this run only.
const demoSessionKey = randomBytes(36).toString("base64url");
const appDatabase = Object.fromEntries(Object.entries(database).filter(([name]) => !ADMIN_ONLY.has(name)));

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
    { name: "public", testIgnore: [/dashboard\.spec\.ts/, /real-circle\.spec\.ts/, /\.setup\.ts/], use: { ...devices["Desktop Chrome"] } },
    { name: "sign-in", testMatch: /\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "signed-in",
      testMatch: /dashboard\.spec\.ts/,
      dependencies: ["sign-in"],
      use: { ...devices["Desktop Chrome"], storageState: SIGNED_IN_STATE },
    },
    // The signed-in person starts a circle of their own. The stand-in signs in
    // one person, so this runs last, after every test that expects them to
    // have none.
    {
      name: "real-circle",
      testMatch: /real-circle\.spec\.ts/,
      dependencies: ["public", "signed-in"],
      use: { ...devices["Desktop Chrome"], storageState: SIGNED_IN_STATE },
    },
  ],
  // The tests run against the production build, started the way the container
  // starts it. The test:e2e script builds first. Each server is started as one
  // process, with no package-manager wrapper, so Playwright can stop it cleanly.
  webServer: [
    {
      // A throwaway PostgreSQL in Docker, migrated (e2e/support/database.ts).
      command: "node e2e/support/database.ts",
      url: `http://localhost:${E2E_DATABASE.healthPort}`,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      timeout: 120_000,
      env: database,
    },
    {
      // A stand-in for Cognito that runs the same sign-in flow (e2e/support).
      command: "node e2e/support/identity-provider.ts",
      url: `${identityProvider}/health`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      // A stand-in for Claude on Bedrock's Messages endpoint (e2e/support).
      command: "node e2e/support/model-stand-in.ts",
      url: `http://localhost:${MODEL_STAND_IN.port}/health`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      // The standalone server through the container's own start file.
      command: "node .next/standalone/apps/web/start.mjs",
      url: baseURL,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      timeout: 60_000,
      env: {
        PORT: String(port),
        KIN_AUTH_ISSUER: identityProvider,
        KIN_AUTH_LOGIN_URL: identityProvider,
        KIN_AUTH_CLIENT_ID: IDENTITY_PROVIDER.clientId,
        KIN_WEB_ORIGIN: baseURL,
        // The app holds only the person's role and the demo provisioner, as in AWS.
        ...appDatabase,
        KIN_DEMO_CIRCLES: "on",
        KIN_DEMO_SESSION_KEY: demoSessionKey,
        // Top-ups on, against addresses nothing answers: the browser's calls to
        // the top-up routes and PayPal's SDK are answered by stand-ins in
        // e2e/top-up.spec.ts, so the server never reaches PayPal or a queue.
        KIN_PAYPAL_CLIENT_ID: "e2e-client",
        KIN_PAYPAL_CLIENT_SECRET: "e2e-secret",
        KIN_PAYPAL_API_URL: "http://127.0.0.1:9",
        KIN_QUEUE_ENDPOINT: "http://127.0.0.1:9",
        KIN_PAYPAL_INBOX_URL: "http://127.0.0.1:9/000000000000/kin-paypal-events.fifo",
        // Claude through the stand-in: the real SDK client, no AWS.
        KIN_BEDROCK_REGION: "us-east-1",
        KIN_BEDROCK_ENDPOINT: `http://127.0.0.1:${MODEL_STAND_IN.port}`,
        // Speech on, so its controls show; the speech tests answer its routes in the browser.
        KIN_SPEECH_REGION: "us-east-1",
      },
    },
  ],
});

function sharedDatabaseEnv(): Record<string, string> {
  const inherited = process.env[E2E_DATABASE.envKey];
  if (inherited) return JSON.parse(inherited) as Record<string, string>;
  const drawn = e2eDatabaseEnv();
  process.env[E2E_DATABASE.envKey] = JSON.stringify(drawn);
  return drawn;
}
