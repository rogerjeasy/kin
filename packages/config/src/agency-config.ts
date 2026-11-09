import { createHmac } from "node:crypto";

import { ConfigError } from "./config-error.ts";
import { DEMO_ENV } from "./demo-config.ts";

/**
 * The key agencies' request secrets are derived from (decision 93). Each
 * agency key's secret is HMAC(signing key, key ID), so the database never
 * holds one. A dedicated `KIN_AGENCY_SIGNING_KEY` is used when it is set.
 * Without it, while the demo is on, a key is derived from the demo session
 * key under its own label (HKDF-style key separation), so the API works in a
 * deployment that has only that secret; changing either key retires every
 * agency key. With neither, the agency API is off.
 */
export const AGENCY_ENV = { signingKey: "KIN_AGENCY_SIGNING_KEY" } as const;

const MIN_KEY_LENGTH = 32;

type Env = Readonly<Record<string, string | undefined>>;

export function readAgencySigningKey(env: Env): string | null {
  const own = env[AGENCY_ENV.signingKey]?.trim() ?? "";
  if (own !== "") {
    if (own.length < MIN_KEY_LENGTH) throw new ConfigError(`${AGENCY_ENV.signingKey} must be at least ${MIN_KEY_LENGTH} characters`);
    return own;
  }
  const demoKey = env[DEMO_ENV.sessionKey]?.trim() ?? "";
  if (env[DEMO_ENV.enabled]?.trim() !== "on" || demoKey.length < MIN_KEY_LENGTH) return null;
  return createHmac("sha256", demoKey).update("kin agency signing key v1", "utf8").digest("base64url");
}
