import { createHmac } from "node:crypto";

import { ConfigError } from "./config-error.ts";
import { DEMO_ENV } from "./demo-config.ts";

/**
 * The key that seals the access token of an authenticator enrolment while the
 * person scans the code (decision 109). A dedicated `KIN_ENROLMENT_KEY` is
 * used when set. Without it, while the demo is on, a key is derived from the
 * demo session key under its own label, as the agency key is (decision 93),
 * so a deployment with only that secret can enrol. With neither, enrolment
 * is off and the screen says Kin cannot set an app up just now.
 */
export const ENROLMENT_ENV = { key: "KIN_ENROLMENT_KEY" } as const;

const MIN_KEY_LENGTH = 32;

type Env = Readonly<Record<string, string | undefined>>;

/** 32 bytes for AES-256-GCM, or `null` when there is no key to derive them from. */
export function readEnrolmentKey(env: Env): Buffer | null {
  const own = env[ENROLMENT_ENV.key]?.trim() ?? "";
  const label = "kin authenticator enrolment key v1";
  if (own !== "") {
    if (own.length < MIN_KEY_LENGTH) throw new ConfigError(`${ENROLMENT_ENV.key} must be at least ${MIN_KEY_LENGTH} characters`);
    return createHmac("sha256", own).update(label, "utf8").digest();
  }
  const demoKey = env[DEMO_ENV.sessionKey]?.trim() ?? "";
  if (env[DEMO_ENV.enabled]?.trim() !== "on" || demoKey.length < MIN_KEY_LENGTH) return null;
  return createHmac("sha256", demoKey).update(label, "utf8").digest();
}
