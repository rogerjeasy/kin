import { ConfigError } from "./config-error.ts";

/**
 * The worker's phone call to the parent about a shift. It needs a Twilio
 * account, a number of Kin's own to call from, the public address of the phone
 * service (the call's answer and status webhooks live there) and the key that
 * seals the call's token (the phone service's `KIN_VOICE_STATE_KEY`, the same
 * value). Every one is required: with any missing the loop does not start and
 * messages stay safely queued, so a half-set deployment never places a call it
 * could not answer.
 */
export const SHIFT_CALL_ENV = {
  accountSid: "KIN_TWILIO_ACCOUNT_SID",
  authToken: "KIN_TWILIO_AUTH_TOKEN",
  callerNumber: "KIN_TWILIO_CALLER_NUMBER",
  publicUrl: "KIN_VOICE_PUBLIC_URL",
  tokenKey: "KIN_VOICE_STATE_KEY",
} as const;

export type ShiftCallConfig =
  | {
      readonly enabled: false;
      /** The names (never the values) of the settings that are not set. All of them when none is. */
      readonly missing: readonly string[];
    }
  | {
      readonly enabled: true;
      readonly accountSid: string;
      readonly authToken: string;
      readonly callerNumber: string;
      /** The phone service's https address with no trailing slash. */
      readonly publicUrl: string;
      readonly tokenKey: string;
    };

type Env = Readonly<Record<string, string | undefined>>;

const ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/;
const E164 = /^\+[1-9][0-9]{6,14}$/;
const MIN_AUTH_TOKEN_CHARS = 16;
const MIN_TOKEN_KEY_CHARS = 32;

/**
 * Reads the settings of the call to the parent. Nothing set, or only some of it, is `enabled: false` with the
 * names that are missing; all set but malformed is a `ConfigError`, because the deployment is wrong. No error
 * and no value returned for a log carries a secret.
 */
export function readShiftCallConfig(env: Env): ShiftCallConfig {
  const value = (name: string): string => env[name]?.trim() ?? "";
  const missing = Object.values(SHIFT_CALL_ENV).filter((name) => value(name) === "");
  if (missing.length > 0) return { enabled: false, missing };

  const accountSid = value(SHIFT_CALL_ENV.accountSid);
  const authToken = value(SHIFT_CALL_ENV.authToken);
  const callerNumber = value(SHIFT_CALL_ENV.callerNumber);
  const tokenKey = value(SHIFT_CALL_ENV.tokenKey);
  const publicUrl = value(SHIFT_CALL_ENV.publicUrl).replace(/\/+$/, "");
  if (!ACCOUNT_SID.test(accountSid)) throw new ConfigError(`${SHIFT_CALL_ENV.accountSid} is not a Twilio account SID`);
  if (authToken.length < MIN_AUTH_TOKEN_CHARS) throw new ConfigError(`${SHIFT_CALL_ENV.authToken} is too short to be Twilio's`);
  if (!E164.test(callerNumber)) throw new ConfigError(`${SHIFT_CALL_ENV.callerNumber} must be a phone number in E.164 form`);
  // Twilio fetches the call's addresses from the internet, and they carry a sealed token: https only, and no underscore in the host.
  if (!/^https:\/\/[^\s/?#_@]+$/.test(publicUrl)) throw new ConfigError(`${SHIFT_CALL_ENV.publicUrl} must be the https address Twilio calls, with no path`);
  if (tokenKey.length < MIN_TOKEN_KEY_CHARS) throw new ConfigError(`${SHIFT_CALL_ENV.tokenKey} must be at least ${MIN_TOKEN_KEY_CHARS} characters`);
  if (tokenKey === authToken) throw new ConfigError(`${SHIFT_CALL_ENV.tokenKey} must differ from ${SHIFT_CALL_ENV.authToken}`);
  return { enabled: true, accountSid, authToken, callerNumber, publicUrl, tokenKey };
}
