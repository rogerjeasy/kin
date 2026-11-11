/**
 * Checks the demo pharmacy's settings in the repository's .env before they are
 * stored (`scripts/store-merchant-secrets.ts`). Each is read under the name the
 * pharmacy uses, or else under the name the sandbox app was first saved with.
 * Errors name the setting and never carry its value.
 */
export const MERCHANT_CREDENTIAL_ENV = {
  clientId: ["KIN_MERCHANT_PAYPAL_CLIENT_ID", "PAYPAL_SANDBOX_MERCHANT_CLIENT_ID"],
  clientSecret: ["KIN_MERCHANT_PAYPAL_CLIENT_SECRET", "PAYPAL_SANDBOX_MERCHANT_CLIENT_SECRET"],
  vaultId: ["KIN_MERCHANT_PAYPAL_VAULT_ID"],
} as const;

export type MerchantCredentials = { readonly clientId: string; readonly clientSecret: string; readonly vaultId: string };

type Env = Readonly<Record<string, string | undefined>>;

/** PayPal's client IDs and secrets are long runs of letters, digits, `-` and `_`. */
const CREDENTIAL = /^[A-Za-z0-9_-]{20,128}$/;
/** The same shape the pharmacy accepts (`readMerchantServiceConfig`). */
const VAULT_ID = /^[A-Za-z0-9_-]{1,64}$/;

const first = (env: Env, names: readonly string[]): string => names.map((name) => env[name]?.trim() ?? "").find((value) => value !== "") ?? "";

/** The three settings, or the problems with them, one line each. */
export function readMerchantCredentials(env: Env): { readonly ok: true; readonly credentials: MerchantCredentials } | { readonly ok: false; readonly problems: readonly string[] } {
  const clientId = first(env, MERCHANT_CREDENTIAL_ENV.clientId);
  const clientSecret = first(env, MERCHANT_CREDENTIAL_ENV.clientSecret);
  const vaultId = first(env, MERCHANT_CREDENTIAL_ENV.vaultId);
  const problems: string[] = [];
  if (!CREDENTIAL.test(clientId)) problems.push(`${MERCHANT_CREDENTIAL_ENV.clientId.join(" or ")} in the repository's .env must be the demo pharmacy's PayPal sandbox client ID.`);
  if (!CREDENTIAL.test(clientSecret)) problems.push(`${MERCHANT_CREDENTIAL_ENV.clientSecret.join(" or ")} in the repository's .env must be the demo pharmacy's PayPal sandbox client secret.`);
  if (!VAULT_ID.test(vaultId)) {
    problems.push(`${MERCHANT_CREDENTIAL_ENV.vaultId[0]} in the repository's .env must be the vault ID Rose's payment method is saved under: run pnpm --filter @kin/paypal run sandbox:check vault-card.`);
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, credentials: { clientId, clientSecret, vaultId } };
}
