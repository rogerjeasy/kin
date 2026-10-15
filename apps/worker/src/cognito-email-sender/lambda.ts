import { CommitmentPolicy, KmsKeyringNode, buildClient } from "@aws-crypto/client-node";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createGmailSender, type EmailSender } from "@kin/notify";

import { createEmailSenderHandler } from "./handler.ts";

/**
 * The Lambda entry point. It reads its settings once, when the function
 * starts, and fails at once if any is missing.
 */
function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const senderAddress = setting("KIN_SENDER_EMAIL");
const secretArn = setting("KIN_GMAIL_SECRET_ARN");
const keyArn = setting("KIN_CODES_KEY_ARN");

const { decrypt } = buildClient(CommitmentPolicy.REQUIRE_ENCRYPT_ALLOW_DECRYPT);
const keyring = new KmsKeyringNode({ keyIds: [keyArn] });
const secrets = new SecretsManagerClient({});

let sender: Promise<EmailSender> | undefined;

async function openSender(): Promise<EmailSender> {
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!secret.SecretString) throw new Error("The Gmail app password secret is empty");
  return createGmailSender({ address: senderAddress, appPassword: secret.SecretString });
}

export const handler = createEmailSenderHandler({
  async decrypt(encryptedCode, userPoolId) {
    const { plaintext, messageHeader } = await decrypt(keyring, Buffer.from(encryptedCode, "base64"));
    // Cognito binds each code to its user pool. A code for another pool is refused.
    if (messageHeader.encryptionContext["userpool-id"] !== userPoolId) {
      throw new Error("The code was not encrypted for this user pool");
    }
    return Buffer.from(plaintext).toString("utf8");
  },
  sender() {
    sender ??= openSender().catch((error: unknown) => {
      // A failed start is tried again on the next code, not cached for the life of the function.
      sender = undefined;
      throw error;
    });
    return sender;
  },
  log(entry) {
    console.log(JSON.stringify(entry));
  },
});
