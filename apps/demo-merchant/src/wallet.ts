import { decimalAmount } from "@kin/domain";

/** The charge was refused or could not be read. `retryable` says whether asking again may help. */
export class ChargeError extends Error {
  readonly retryable: boolean;

  constructor(retryable: boolean, message: string) {
    super(message);
    this.name = "ChargeError";
    this.retryable = retryable;
  }
}

/**
 * Takes money from the family pool's PayPal wallet, saved with this seller
 * once (docs/architecture.md section 8.6). The same `key` is one charge: a
 * repeated request must not take the money twice.
 */
export type WalletCharger = {
  readonly charge: (charge: { readonly key: string; readonly cents: number; readonly currency: string; readonly description: string }) => Promise<{ readonly captureId: string }>;
};

/** For a sandbox without credentials: nothing is charged, and the capture's ID says so. */
export const simulatedWallet: WalletCharger = {
  charge: async ({ key }) => ({ captureId: `simulated-capture-${key}` }),
};

type PayPalWallet = {
  readonly baseUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** The payment token the pool's wallet was saved under, from the one-time approval. */
  readonly vaultId: string;
  readonly send?: typeof fetch;
};

/**
 * Charges the pool's saved PayPal wallet with nobody signing in: one order
 * that carries only the vault ID, created and captured in a single call (the
 * sandbox check of 14 October 2026). PayPal's own record decides: the charge
 * is made only if the capture reads back `COMPLETED` for exactly the amount
 * asked, and the request ID makes a repeat the same charge.
 */
export function paypalSavedWallet(wallet: PayPalWallet): WalletCharger {
  const send = wallet.send ?? fetch;
  const call = async (path: string, init: RequestInit): Promise<Record<string, unknown>> => {
    const response = await send(new URL(path, wallet.baseUrl), init).catch(() => {
      throw new ChargeError(true, "PayPal could not be reached");
    });
    if (response.status >= 500 || response.status === 429) throw new ChargeError(true, `PayPal answered ${response.status}`);
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new ChargeError(false, `PayPal refused with ${response.status}`);
    if (typeof body !== "object" || body === null) throw new ChargeError(true, "PayPal sent nothing readable");
    return body as Record<string, unknown>;
  };
  return {
    charge: async ({ key, cents, currency, description }) => {
      const token = await call("/v1/oauth2/token", {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`${wallet.clientId}:${wallet.clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      });
      if (typeof token["access_token"] !== "string") throw new ChargeError(true, "PayPal sent no access token");
      const amount = decimalAmount({ cents, currency });
      const order = await call("/v2/checkout/orders", {
        method: "POST",
        headers: { authorization: `Bearer ${token["access_token"]}`, "content-type": "application/json", "paypal-request-id": key },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [{ description, amount: { currency_code: currency, value: amount } }],
          payment_source: { paypal: { vault_id: wallet.vaultId } },
        }),
      });
      const capture = firstCapture(order);
      if (capture === null || capture.status !== "COMPLETED" || capture.value !== amount || capture.currency !== currency) {
        throw new ChargeError(false, "PayPal's record does not show this charge completed for this amount");
      }
      return { captureId: capture.id };
    },
  };
}

function firstCapture(order: Record<string, unknown>): { id: string; status: string; value: string; currency: string } | null {
  const units = order["purchase_units"];
  const unit: unknown = Array.isArray(units) ? units[0] : null;
  const payments = typeof unit === "object" && unit !== null ? (unit as Record<string, unknown>)["payments"] : null;
  const captures = typeof payments === "object" && payments !== null ? (payments as Record<string, unknown>)["captures"] : null;
  const first: unknown = Array.isArray(captures) ? captures[0] : null;
  if (typeof first !== "object" || first === null) return null;
  const record = first as Record<string, unknown>;
  const amount = typeof record["amount"] === "object" && record["amount"] !== null ? (record["amount"] as Record<string, unknown>) : {};
  const { id, status } = record;
  const { value, currency_code: currency } = amount;
  return typeof id === "string" && typeof status === "string" && typeof value === "string" && typeof currency === "string" ? { id, status, value, currency } : null;
}
