import { ConfigError } from "./config-error.ts";

/**
 * Real PayPal sandbox payouts in demo circles. When a Kin-owned sandbox
 * personal account is named, an approved demo caregiver payout is paid
 * through PayPal's sandbox to that account, and only that account: never an
 * address a visitor typed. Off when no address is set, and every demo payout
 * stays simulated.
 */
export type SandboxPayoutConfig =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly payeeEmail: string; readonly dailyLimit: number };

export const SANDBOX_PAYOUT_ENV = {
  payeeEmail: "KIN_DEMO_SANDBOX_PAYEE_EMAIL",
  dailyLimit: "KIN_DEMO_SANDBOX_PAYOUTS_PER_DAY",
} as const;

export const SANDBOX_PAYOUTS_PER_DAY_DEFAULT = 25;
const MAX_DAILY_LIMIT = 1_000;
// One address, no spaces or display name: what PayPal's Payouts API takes as an EMAIL receiver.
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
const MAX_EMAIL_LENGTH = 254;

type Env = Readonly<Record<string, string | undefined>>;

export function readSandboxPayoutConfig(env: Env): SandboxPayoutConfig {
  const payeeEmail = env[SANDBOX_PAYOUT_ENV.payeeEmail]?.trim() ?? "";
  if (payeeEmail === "") return { enabled: false };
  if (payeeEmail.length > MAX_EMAIL_LENGTH || !EMAIL.test(payeeEmail)) {
    throw new ConfigError(`${SANDBOX_PAYOUT_ENV.payeeEmail} must be one email address, a Kin-owned PayPal sandbox personal account`);
  }
  return { enabled: true, payeeEmail, dailyLimit: dailyLimit(env[SANDBOX_PAYOUT_ENV.dailyLimit]) };
}

function dailyLimit(raw: string | undefined): number {
  const text = raw?.trim() ?? "";
  if (text === "") return SANDBOX_PAYOUTS_PER_DAY_DEFAULT;
  const value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < 1 || value > MAX_DAILY_LIMIT) {
    throw new ConfigError(`${SANDBOX_PAYOUT_ENV.dailyLimit} must be a whole number from 1 to ${MAX_DAILY_LIMIT}`);
  }
  return value;
}
