import { ConfigError } from "./config-error.ts";

/**
 * The text Kin sends a family member for "is it really you?": to confirm their
 * number, and to ask whether it is them on the phone. It needs a Twilio account,
 * a sender number (or messaging service) of Kin's own, and the web app's public
 * address, where the link in the text leads. Every one is required: with any
 * missing the loop does not start, the messages stay queued, and a check simply
 * ends "could not be reached" after ninety seconds, which is true.
 */
export const PRESENCE_TEXT_ENV = {
  accountSid: "KIN_TWILIO_ACCOUNT_SID",
  authToken: "KIN_TWILIO_AUTH_TOKEN",
  from: "KIN_TWILIO_SMS_FROM",
  webUrl: "KIN_WEB_PUBLIC_URL",
} as const;

export type PresenceTextConfig =
  | { readonly enabled: false; readonly missing: readonly string[] }
  | {
      readonly enabled: true;
      readonly accountSid: string;
      readonly authToken: string;
      readonly sender: { readonly from: string } | { readonly messagingServiceSid: string };
      /** The web app's https address with no trailing slash. */
      readonly webUrl: string;
    };

type Env = Readonly<Record<string, string | undefined>>;

const ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/;
const MESSAGING_SERVICE_SID = /^MG[0-9a-fA-F]{32}$/;
const E164 = /^\+[1-9][0-9]{6,14}$/;

/** Nothing set, or only some of it, is `enabled: false` with the names that are missing; all set but malformed is a `ConfigError`. No value is ever returned in a message. */
export function readPresenceTextConfig(env: Env): PresenceTextConfig {
  const value = (name: string): string => env[name]?.trim() ?? "";
  const missing = Object.values(PRESENCE_TEXT_ENV).filter((name) => value(name) === "");
  if (missing.length > 0) return { enabled: false, missing };
  const accountSid = value(PRESENCE_TEXT_ENV.accountSid);
  const from = value(PRESENCE_TEXT_ENV.from);
  const webUrl = value(PRESENCE_TEXT_ENV.webUrl).replace(/\/+$/, "");
  if (!ACCOUNT_SID.test(accountSid)) throw new ConfigError(`${PRESENCE_TEXT_ENV.accountSid} is not a Twilio account SID`);
  if (value(PRESENCE_TEXT_ENV.authToken).length < 16) throw new ConfigError(`${PRESENCE_TEXT_ENV.authToken} is too short to be Twilio's`);
  if (!E164.test(from) && !MESSAGING_SERVICE_SID.test(from)) throw new ConfigError(`${PRESENCE_TEXT_ENV.from} must be a phone number in E.164 form or a messaging service SID`);
  // The link is texted to a phone and carries a secret: https only, no path or credentials.
  if (!/^https:\/\/[^\s/?#@]+$/.test(webUrl)) throw new ConfigError(`${PRESENCE_TEXT_ENV.webUrl} must be the https address of the web app, with no path`);
  return { enabled: true, accountSid, authToken: value(PRESENCE_TEXT_ENV.authToken), sender: from.startsWith("MG") ? { messagingServiceSid: from } : { from }, webUrl };
}
