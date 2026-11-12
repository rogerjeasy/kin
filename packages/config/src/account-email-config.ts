import { ConfigError } from "./config-error.ts";
import { INVITATION_EMAIL_ENV } from "./invitation-email-config.ts";

/**
 * The web app's own email to a person about their account, such as "an
 * authenticator app was just set up": sent from the same Gmail account as the
 * sign-in codes and invitations. Off, with the names missing, until both are set.
 */
export const ACCOUNT_EMAIL_ENV = { sender: INVITATION_EMAIL_ENV.sender, appPassword: INVITATION_EMAIL_ENV.appPassword } as const;

export type AccountEmailConfig =
  | { readonly enabled: false; readonly missing: readonly string[] }
  | { readonly enabled: true; readonly sender: string; readonly appPassword: string };

type Env = Readonly<Record<string, string | undefined>>;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_APP_PASSWORD_CHARS = 16;

export function readAccountEmailConfig(env: Env): AccountEmailConfig {
  const value = (name: string): string => env[name]?.trim() ?? "";
  const missing = Object.values(ACCOUNT_EMAIL_ENV).filter((name) => value(name) === "");
  if (missing.length > 0) return { enabled: false, missing };
  const sender = value(ACCOUNT_EMAIL_ENV.sender);
  const appPassword = value(ACCOUNT_EMAIL_ENV.appPassword);
  if (!EMAIL.test(sender)) throw new ConfigError(`${ACCOUNT_EMAIL_ENV.sender} is not an email address`);
  if (appPassword.replace(/\s/g, "").length < MIN_APP_PASSWORD_CHARS) throw new ConfigError(`${ACCOUNT_EMAIL_ENV.appPassword} is too short to be a Google app password`);
  return { enabled: true, sender, appPassword };
}
