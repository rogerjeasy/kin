import { execFileSync } from "node:child_process";

import { normalizeAppPassword } from "@kin/notify";

import { GMAIL_SECRET_NAME } from "../src/gmail-secret-name.ts";

/**
 * Copies the Gmail app password from the repository's .env into the secret
 * Kin's sign-in email sender reads. The password goes to the AWS CLI on its
 * standard input, never on the command line, so no process list shows it.
 *
 *   AWS_PROFILE=wick-dev pnpm --filter @kin/infra run gmail:store
 */
const password = normalizeAppPassword(process.env["KIN_GMAIL_APP_PASSWORD"] ?? "");
// Google's app passwords are sixteen letters.
if (!/^[a-z]{16}$/i.test(password)) {
  console.error("KIN_GMAIL_APP_PASSWORD in the repository's .env must be the 16-letter app password from myaccount.google.com/apppasswords.");
  process.exit(1);
}

execFileSync(
  "aws",
  ["secretsmanager", "put-secret-value", "--secret-id", GMAIL_SECRET_NAME, "--secret-string", "file:///dev/stdin", "--region", "us-east-1"],
  { input: password, stdio: ["pipe", "ignore", "inherit"] },
);
console.log(`Stored the app password in ${GMAIL_SECRET_NAME}.`);
