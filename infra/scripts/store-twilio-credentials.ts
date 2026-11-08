import { execFileSync } from "node:child_process";

import { TWILIO_SETTINGS } from "../src/database-settings.ts";
import { readTwilioCredentials } from "../src/twilio-credentials.ts";

/**
 * Copies Kin's Twilio account SID and auth token from the repository's .env
 * into the two secrets KinData holds for them. Each goes to the AWS CLI on its
 * standard input, never on the command line, so no process list shows it, and
 * neither is ever printed.
 *
 *   AWS_PROFILE=wick-dev pnpm --filter @kin/infra run twilio:store
 */
const read = readTwilioCredentials(process.env);
if (!read.ok) {
  for (const problem of read.problems) console.error(problem);
  process.exit(1);
}

function store(secretName: string, value: string): void {
  try {
    execFileSync("aws", ["secretsmanager", "put-secret-value", "--secret-id", secretName, "--secret-string", "file:///dev/stdin", "--region", "us-east-1"], {
      input: value,
      stdio: ["pipe", "ignore", "pipe"],
      encoding: "utf8",
    });
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    // KinData makes the slot. Until a deployment that includes it has run, there is nothing to fill.
    console.error(
      stderr.includes("ResourceNotFoundException")
        ? `${secretName} does not exist yet. KinData creates it: wait for the deployment of main to finish, then run this again.`
        : "The AWS CLI could not store the secret. Check the AWS profile and that KinData is deployed.",
    );
    process.exit(1);
  }
}

store(TWILIO_SETTINGS.accountSidSecretName, read.credentials.accountSid);
store(TWILIO_SETTINGS.authTokenSecretName, read.credentials.authToken);
console.log("Stored the Twilio account SID and auth token.");
