/**
 * Checks the Twilio credentials in the repository's .env before they are
 * stored (`scripts/store-twilio-credentials.ts`). Errors name the setting and
 * never carry its value.
 */
export const TWILIO_CREDENTIAL_ENV = { accountSid: "KIN_TWILIO_ACCOUNT_SID", authToken: "KIN_TWILIO_AUTH_TOKEN" } as const;

export type TwilioCredentials = { readonly accountSid: string; readonly authToken: string };

type Env = Readonly<Record<string, string | undefined>>;

/** An account SID is `AC` and 32 hexadecimal characters: 34 in all. */
const ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/;
/** Twilio's auth tokens are 32 hexadecimal characters; the check allows any longer plain alphanumeric one. */
const AUTH_TOKEN = /^[0-9a-zA-Z]{32,}$/;

/** The two credentials, or the problems with them, one line each. */
export function readTwilioCredentials(env: Env): { readonly ok: true; readonly credentials: TwilioCredentials } | { readonly ok: false; readonly problems: readonly string[] } {
  const accountSid = (env[TWILIO_CREDENTIAL_ENV.accountSid] ?? "").trim();
  const authToken = (env[TWILIO_CREDENTIAL_ENV.authToken] ?? "").trim();
  const problems: string[] = [];
  if (!ACCOUNT_SID.test(accountSid)) {
    problems.push(`${TWILIO_CREDENTIAL_ENV.accountSid} in the repository's .env must be the account SID from console.twilio.com: AC followed by 32 hexadecimal characters (34 in all).`);
  }
  if (!AUTH_TOKEN.test(authToken)) {
    problems.push(`${TWILIO_CREDENTIAL_ENV.authToken} in the repository's .env must be the account's auth token from console.twilio.com: at least 32 letters and digits.`);
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, credentials: { accountSid, authToken } };
}
