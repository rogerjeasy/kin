import { ConfigError } from "./config-error.ts";

/** PayPal's sandbox, the only PayPal environment Kin talks to today. */
export const PAYPAL_SANDBOX_API = "https://api-m.sandbox.paypal.com";

export const PAYPAL_ENV = {
  clientId: "KIN_PAYPAL_CLIENT_ID",
  clientSecret: "KIN_PAYPAL_CLIENT_SECRET",
  webhookId: "KIN_PAYPAL_WEBHOOK_ID",
  /** A stand-in for PayPal's API, on this machine, for tests. */
  apiUrl: "KIN_PAYPAL_API_URL",
} as const;

/**
 * The pool's PayPal app. `clientId` is safe to publish (the browser SDK needs
 * it); the secret never leaves the server. Off when no client ID is set, so a
 * deployment without PayPal still serves every other screen.
 */
export type PayPalConfig =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly apiUrl: string; readonly clientId: string; readonly clientSecret: string; readonly webhookId: string | null };

type Env = Readonly<Record<string, string | undefined>>;

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Reads the pool's PayPal settings. The API is PayPal's sandbox, or a stand-in
 * on this machine; any other address is refused, so no setting can point Kin
 * at live money before the project decides to.
 */
export function readPayPalConfig(env: Env, needs: { webhook: boolean }): PayPalConfig {
  const clientId = env[PAYPAL_ENV.clientId]?.trim() ?? "";
  if (clientId === "") return { enabled: false };
  const clientSecret = required(env, PAYPAL_ENV.clientSecret);
  const apiUrl = env[PAYPAL_ENV.apiUrl]?.trim() || PAYPAL_SANDBOX_API;
  if (apiUrl !== PAYPAL_SANDBOX_API && !LOCAL.test(apiUrl)) {
    throw new ConfigError(`${PAYPAL_ENV.apiUrl} must be PayPal's sandbox or a stand-in on this machine`);
  }
  const webhookId = needs.webhook ? required(env, PAYPAL_ENV.webhookId) : null;
  return { enabled: true, apiUrl, clientId, clientSecret, webhookId };
}

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`${name} must be set when ${PAYPAL_ENV.clientId} is`);
  return value;
}
