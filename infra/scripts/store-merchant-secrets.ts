import { execFileSync } from "node:child_process";

import { DEMO_MERCHANT_SETTINGS } from "../src/database-settings.ts";
import { readMerchantCredentials } from "../src/merchant-credentials.ts";

/**
 * Copies the demo pharmacy's PayPal sandbox app (client ID and secret) and the
 * vault ID of Rose's saved payment method from the repository's .env into the
 * three secrets KinData holds for them once `kin:demoMerchant` is on. Each
 * goes to the AWS CLI on its standard input, never on the command line, so no
 * process list shows it, and none is ever printed. The signing secret is
 * generated in Secrets Manager and is not touched.
 *
 *   AWS_PROFILE=wick-dev pnpm --filter @kin/infra run merchant:store
 *
 * App Runner reads secrets when it starts the service, so start a new
 * deployment of kin-demo-merchant afterwards (the command is printed).
 */
const read = readMerchantCredentials(process.env);
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
    console.error(
      stderr.includes("ResourceNotFoundException")
        ? `${secretName} does not exist yet. KinData creates it once kin:demoMerchant is true: deploy, then run this again.`
        : "The AWS CLI could not store the secret. Check the AWS profile and that KinData is deployed.",
    );
    process.exit(1);
  }
}

store(DEMO_MERCHANT_SETTINGS.clientIdSecretName, read.credentials.clientId);
store(DEMO_MERCHANT_SETTINGS.clientSecretSecretName, read.credentials.clientSecret);
store(DEMO_MERCHANT_SETTINGS.vaultIdSecretName, read.credentials.vaultId);
console.log("Stored the demo pharmacy's PayPal app and vault ID. To have the running service read them:");
console.log(
  "  aws apprunner start-deployment --region us-east-1 --service-arn $(aws apprunner list-services --region us-east-1 --query \"ServiceSummaryList[?ServiceName=='kin-demo-merchant'].ServiceArn\" --output text)",
);
