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

execFileSync(
  "aws",
  ["secretsmanager", "put-secret-value", "--secret-id", PAYPAL_SETTINGS.secretName, "--secret-string", "file:///dev/stdin", "--region", "us-east-1"],
  { input: secret, stdio: ["pipe", "ignore", "inherit"] },
);
console.log(`Stored the PayPal client secret in ${PAYPAL_SETTINGS.secretName}.`);
