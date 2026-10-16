import { execFileSync } from "node:child_process";

import { PAYPAL_SETTINGS } from "../src/database-settings.ts";

/**
 * Copies the pool's PayPal client secret from the repository's .env into the
 * secret the web app and the worker read. The secret goes to the AWS CLI on
 * its standard input, never on the command line, so no process list shows it.
 *
 *   AWS_PROFILE=wick-dev pnpm --filter @kin/infra run paypal:store
 */
const secret = (process.env["KIN_PAYPAL_CLIENT_SECRET"] ?? "").trim();
if (secret.length < 20) {
  console.error("KIN_PAYPAL_CLIENT_SECRET in the repository's .env must be the pool app's secret, from developer.paypal.com > Apps & Credentials > Sandbox.");
  process.exit(1);
}

try {
  execFileSync(
    "aws",
    ["secretsmanager", "put-secret-value", "--secret-id", PAYPAL_SETTINGS.secretName, "--secret-string", "file:///dev/stdin", "--region", "us-east-1"],
    { input: secret, stdio: ["pipe", "ignore", "pipe"], encoding: "utf8" },
  );
} catch (error) {
  const stderr = String((error as { stderr?: unknown }).stderr ?? "");
  // KinData makes the slot. Until a deployment that includes it has run, there is nothing to fill.
  console.error(
    stderr.includes("ResourceNotFoundException")
      ? `${PAYPAL_SETTINGS.secretName} does not exist yet. KinData creates it: wait for the deployment of main to finish, then run this again.`
      : stderr.trim() || "The AWS CLI could not store the secret.",
  );
  process.exit(1);
}
console.log(`Stored the PayPal client secret in ${PAYPAL_SETTINGS.secretName}.`);
