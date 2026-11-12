import { ConfigError } from "./config-error.ts";

/**
 * The email that invites someone to a family's circle. It is sent from Kin's
 * Gmail account (the one that sends sign-in codes) and links to the web app's
 * public address. Every setting is required: with any missing the loop does not
 * start and the invitations stay queued, still accepted at sign-in by address.
 */
export const INVITATION_EMAIL_ENV = {
  sender: "KIN_SENDER_EMAIL",
  appPassword: "KIN_GMAIL_APP_PASSWORD",
  webUrl: "KIN_WEB_PUBLIC_URL",
} as const;

/**
 * How many invitation emails Kin sends in a day, across every circle. The Gmail
 * account also sends the sign-in codes and takes about five hundred messages a
 * day, so invitations stop well short of that and the codes always get through.
 * Optional: unset is the default.
 */
export const INVITATION_EMAILS_PER_DAY_ENV = "KIN_INVITATION_EMAILS_PER_DAY";
export const INVITATION_EMAILS_PER_DAY_DEFAULT = 200;
/** Above this the codes would have too little room left. */
const MAX_INVITATION_EMAILS_PER_DAY = 300;

export type InvitationEmailConfig =
  | { readonly enabled: false; readonly missing: readonly string[] }
  | {
      readonly enabled: true;
      readonly sender: string;
      readonly appPassword: string;
      /** The web app's https address with no trailing slash. */
      readonly webUrl: string;
      /** The most invitation emails sent in any 24 hours; past it the rest wait. */
      readonly perDay: number;
    };

type Env = Readonly<Record<string, string | undefined>>;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** A Google app password is sixteen letters, often shown in four groups. */
const MIN_APP_PASSWORD_CHARS = 16;

/** Nothing set, or only some of it, is `enabled: false` with the names that are missing; all set but malformed is a `ConfigError`. No value is ever returned in a message. */
export function readInvitationEmailConfig(env: Env): InvitationEmailConfig {
  const value = (name: string): string => env[name]?.trim() ?? "";
  const missing = Object.values(INVITATION_EMAIL_ENV).filter((name) => value(name) === "");
  if (missing.length > 0) return { enabled: false, missing };
  const sender = value(INVITATION_EMAIL_ENV.sender);
  const appPassword = value(INVITATION_EMAIL_ENV.appPassword);
  const webUrl = value(INVITATION_EMAIL_ENV.webUrl).replace(/\/+$/, "");
  if (!EMAIL.test(sender)) throw new ConfigError(`${INVITATION_EMAIL_ENV.sender} is not an email address`);
  if (appPassword.replace(/\s/g, "").length < MIN_APP_PASSWORD_CHARS) throw new ConfigError(`${INVITATION_EMAIL_ENV.appPassword} is too short to be a Google app password`);
  // The link is emailed: https only, no path or credentials.
  if (!/^https:\/\/[^\s/?#@]+$/.test(webUrl)) throw new ConfigError(`${INVITATION_EMAIL_ENV.webUrl} must be the https address of the web app, with no path`);
  const rawPerDay = value(INVITATION_EMAILS_PER_DAY_ENV);
  const perDay = rawPerDay === "" ? INVITATION_EMAILS_PER_DAY_DEFAULT : Number(rawPerDay);
  if (!/^[0-9]+$/.test(rawPerDay === "" ? "0" : rawPerDay) || !Number.isSafeInteger(perDay) || perDay < 1 || perDay > MAX_INVITATION_EMAILS_PER_DAY) {
    throw new ConfigError(`${INVITATION_EMAILS_PER_DAY_ENV} must be a whole number from 1 to ${MAX_INVITATION_EMAILS_PER_DAY}`);
  }
  return { enabled: true, sender, appPassword, webUrl, perDay };
}
