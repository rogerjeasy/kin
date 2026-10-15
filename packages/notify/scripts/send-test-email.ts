import { createGmailSender } from "../src/gmail.ts";
import { signInEmail } from "../src/sign-in-email.ts";

/**
 * Sends one sign-in email from the Gmail account to itself, with the values
 * in the repository's .env. Run it before switching email codes on, to prove
 * the app password works: `pnpm --filter @kin/notify run gmail:test`.
 */
const address = process.env["KIN_SENDER_EMAIL"]?.trim() ?? "";
const appPassword = process.env["KIN_GMAIL_APP_PASSWORD"] ?? "";
if (!address || !appPassword.trim()) {
  console.error("Set KIN_SENDER_EMAIL and KIN_GMAIL_APP_PASSWORD in the repository's .env first.");
  process.exit(1);
}

const message = signInEmail("sign_in", "123456 (a test: Kin's Gmail sender works)");
await createGmailSender({ address, appPassword }).send({ to: address, ...message });
console.log(`Sent a test sign-in email to ${address}. Check that inbox.`);
