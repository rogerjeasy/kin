import { ConfigError } from "./config-error.ts";

/** The demo: whether the Demo button works, and the key that signs a visitor's session. */
export type DemoConfig = { readonly enabled: false } | { readonly enabled: true; readonly sessionKey: string };

export const DEMO_ENV = { enabled: "KIN_DEMO_CIRCLES", sessionKey: "KIN_DEMO_SESSION_KEY" } as const;

const MIN_KEY_LENGTH = 32;

type Env = Readonly<Record<string, string | undefined>>;

/** Reads the demo settings. Switched on, it refuses to start without a strong key. */
export function readDemoConfig(env: Env): DemoConfig {
  if (env[DEMO_ENV.enabled]?.trim() !== "on") return { enabled: false };
  const sessionKey = env[DEMO_ENV.sessionKey]?.trim() ?? "";
  if (sessionKey.length < MIN_KEY_LENGTH) {
    throw new ConfigError(`${DEMO_ENV.sessionKey} must be set to at least ${MIN_KEY_LENGTH} characters when the demo is on`);
  }
  return { enabled: true, sessionKey };
}
