import { createTwilioTextSender, type TextSender } from "@kin/notify";

/** The settings of the text that carries a check-in link. All three, or the button is not shown. */
export const TEXT_ENV = {
  accountSid: "KIN_TWILIO_ACCOUNT_SID",
  authToken: "KIN_TWILIO_AUTH_TOKEN",
  from: "KIN_TWILIO_SMS_FROM",
} as const;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The text sender, or `null` when this deployment has none: any of the three
 * settings missing means texting is off, and the screen says so. A malformed
 * setting is a misconfigured deployment and also reads as off here, so a typo
 * hides a button rather than breaking the screen; the sender itself refuses it.
 */
export function readTextSender(env: Env): TextSender | null {
  const accountSid = env[TEXT_ENV.accountSid]?.trim() ?? "";
  const authToken = env[TEXT_ENV.authToken]?.trim() ?? "";
  const from = env[TEXT_ENV.from]?.trim() ?? "";
  if (accountSid === "" || authToken === "" || from === "") return null;
  try {
    return createTwilioTextSender({ accountSid, authToken, sender: from.startsWith("MG") ? { messagingServiceSid: from } : { from } });
  } catch {
    return null;
  }
}

let sender: TextSender | null | undefined;

/** The one sender for this server, read on first use and never at build time. */
export function textSender(): TextSender | null {
  sender ??= readTextSender(process.env);
  return sender;
}
