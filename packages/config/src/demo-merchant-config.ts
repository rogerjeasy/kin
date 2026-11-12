import { ConfigError } from "./config-error.ts";
import { isLocalAddress } from "./local-address.ts";
import { PAYPAL_SANDBOX_API } from "./paypal-config.ts";

/**
 * The demo pharmacy (`apps/demo-merchant`) and Kin's worker, which buys from
 * it. They share one signing secret: the worker signs every request with it
 * and the pharmacy refuses any request it does not sign. In AWS it is
 * generated in Secrets Manager and given to both; locally it is any long
 * random string in the root `.env`.
 */
export const DEMO_MERCHANT_ENV = {
  /** Where the worker reaches the pharmacy. Unset, the worker's seller is simulated in process. */
  url: "KIN_DEMO_MERCHANT_URL",
  signingSecret: "KIN_DEMO_MERCHANT_SIGNING_SECRET",
  /** The pharmacy's own PayPal sandbox app, and the payment token Rose's saved payment method is stored under. */
  clientId: "KIN_MERCHANT_PAYPAL_CLIENT_ID",
  clientSecret: "KIN_MERCHANT_PAYPAL_CLIENT_SECRET",
  vaultId: "KIN_MERCHANT_PAYPAL_VAULT_ID",
  paypalUrl: "KIN_MERCHANT_PAYPAL_URL",
  chargesPerDay: "KIN_MERCHANT_CHARGES_PER_DAY",
} as const;

export const MIN_SIGNING_SECRET_CHARS = 32;
export const MERCHANT_CHARGES_PER_DAY_DEFAULT = 20;
const MAX_CHARGES_PER_DAY = 1_000;
const VAULT_ID = /^[A-Za-z0-9_-]{1,64}$/;

type Env = Readonly<Record<string, string | undefined>>;

const valueOf = (env: Env, name: string): string => env[name]?.trim() ?? "";

function signingSecret(env: Env): string {
  const secret = valueOf(env, DEMO_MERCHANT_ENV.signingSecret);
  if (secret.length < MIN_SIGNING_SECRET_CHARS) throw new ConfigError(`${DEMO_MERCHANT_ENV.signingSecret} must be at least ${MIN_SIGNING_SECRET_CHARS} characters`);
  return secret;
}

/** The worker's view: `null` keeps the seller simulated in process; a named pharmacy needs the signing secret too. */
export type DemoMerchantConfig = { readonly url: string; readonly signingSecret: string } | null;

export function readDemoMerchantConfig(env: Env): DemoMerchantConfig {
  const url = valueOf(env, DEMO_MERCHANT_ENV.url).replace(/\/+$/, "");
  if (url === "") return null;
  // Over the internet only by https; plain http only to this machine.
  if (!/^https:\/\/[^\s/?#@]+$/.test(url) && !isLocalAddress(url)) throw new ConfigError(`${DEMO_MERCHANT_ENV.url} must be an https address with no path, or a local http one`);
  return { url, signingSecret: signingSecret(env) };
}

/** How the pharmacy is paid: Rose's saved payment method through its own sandbox app, or nothing at all, and saying so. */
export type MerchantWalletConfig =
  | { readonly kind: "simulated" }
  | { readonly kind: "paypal_sandbox"; readonly baseUrl: string; readonly clientId: string; readonly clientSecret: string; readonly vaultId: string };

export type MerchantServiceConfig = { readonly signingSecret: string; readonly wallet: MerchantWalletConfig; readonly chargesPerDay: number };

/**
 * The pharmacy's own settings. It refuses to start without the signing
 * secret, so it never takes an order nobody signed. With none of the three
 * PayPal settings it charges nothing and says so; with only some of them the
 * deployment is wrong. It charges PayPal's sandbox only, never live money.
 */
export function readMerchantServiceConfig(env: Env): MerchantServiceConfig {
  const secret = signingSecret(env);
  const names = [DEMO_MERCHANT_ENV.clientId, DEMO_MERCHANT_ENV.clientSecret, DEMO_MERCHANT_ENV.vaultId];
  const set = names.filter((name) => valueOf(env, name) !== "");
  const chargesPerDay = dailyCharges(env[DEMO_MERCHANT_ENV.chargesPerDay]);
  if (set.length === 0) return { signingSecret: secret, wallet: { kind: "simulated" }, chargesPerDay };
  if (set.length < names.length) throw new ConfigError(`The pharmacy's PayPal settings are incomplete: set ${names.filter((name) => !set.includes(name)).join(", ")}, or none of them`);
  const baseUrl = valueOf(env, DEMO_MERCHANT_ENV.paypalUrl) || PAYPAL_SANDBOX_API;
  if (baseUrl !== PAYPAL_SANDBOX_API && !isLocalAddress(baseUrl)) throw new ConfigError(`${DEMO_MERCHANT_ENV.paypalUrl} must be PayPal's sandbox or a local stand-in`);
  const vaultId = valueOf(env, DEMO_MERCHANT_ENV.vaultId);
  if (!VAULT_ID.test(vaultId)) throw new ConfigError(`${DEMO_MERCHANT_ENV.vaultId} is not a PayPal payment token ID`);
  const wallet = { kind: "paypal_sandbox", baseUrl, clientId: valueOf(env, DEMO_MERCHANT_ENV.clientId), clientSecret: valueOf(env, DEMO_MERCHANT_ENV.clientSecret), vaultId } as const;
  if (wallet.clientSecret === secret) throw new ConfigError(`${DEMO_MERCHANT_ENV.signingSecret} must differ from ${DEMO_MERCHANT_ENV.clientSecret}`);
  return { signingSecret: secret, wallet, chargesPerDay };
}

function dailyCharges(raw: string | undefined): number {
  const text = raw?.trim() ?? "";
  if (text === "") return MERCHANT_CHARGES_PER_DAY_DEFAULT;
  const value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < 1 || value > MAX_CHARGES_PER_DAY) {
    throw new ConfigError(`${DEMO_MERCHANT_ENV.chargesPerDay} must be a whole number from 1 to ${MAX_CHARGES_PER_DAY}`);
  }
  return value;
}
