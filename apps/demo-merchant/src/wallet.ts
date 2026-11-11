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
 * What a charge was. A real one carries PayPal's order and capture IDs; a
 * simulated one carries no ID at all, so it can never pass for a real one.
 */
export type Charge = { readonly kind: "simulated" } | { readonly kind: "paypal"; readonly orderId: string; readonly captureId: string };

/** PayPal's own record of an order the pharmacy made, read from PayPal at the moment it is asked for. */
export type PaymentRecord = {
  readonly orderId: string;
  readonly status: string;
  /** The buyer's key the order was made under, so the buyer can tell the order is the one it asked for. */
  readonly customId: string | null;
  readonly capture: { readonly id: string; readonly status: string; readonly value: string; readonly currency: string } | null;
};

/**
 * Takes money from Rose's payment method, saved with this seller once
 * (docs/architecture.md section 8.6). The same `key` is one charge: a
 * repeated request must not take the money twice. `readOrder` asks PayPal
 * again what an order it made now says; `null` means there is no such order.
 */
export type WalletCharger = {
  readonly charge: (charge: { readonly key: string; readonly cents: number; readonly currency: string; readonly description: string }) => Promise<Charge>;
  readonly readOrder: (orderId: string) => Promise<PaymentRecord | null>;
};

/** For a sandbox without credentials: nothing is charged, the answer says so, and there is no PayPal order to read. */
export const simulatedWallet: WalletCharger = {
  charge: async () => ({ kind: "simulated" }),
  readOrder: async () => null,
};

type PayPalWallet = {
  readonly baseUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** The payment token the saved payment method is stored under, from the one-time approval (a PayPal wallet) or the saving of a card. */
  readonly vaultId: string;
  readonly send?: typeof fetch;
};

/** PayPal's order IDs: letters and digits. Anything else is never sent to PayPal. */
export const PAYPAL_ORDER_ID = /^[A-Z0-9]{8,36}$/;

/** The kinds of saved payment method an order can carry by its vault ID. */
const SOURCES = ["paypal", "card"] as const;
type Source = (typeof SOURCES)[number];

/**
 * Charges the saved payment method with nobody signing in: one order that
 * carries only the vault ID, created and captured in a single call (the
 * sandbox check of 14 October 2026). PayPal's own record decides: the charge
 * is made only if the capture reads back `COMPLETED` for exactly the amount
 * asked, and the request ID makes a repeat the same charge. Whether the token
 * is a PayPal wallet or a card is read once from the vault itself, so nothing
 * has to be configured beside its ID.
 */
export function paypalSavedWallet(wallet: PayPalWallet): WalletCharger {
  const send = wallet.send ?? fetch;
  const call = async (path: string, init: RequestInit): Promise<Record<string, unknown> | null> => {
    const response = await send(new URL(path, wallet.baseUrl), init).catch(() => {
      throw new ChargeError(true, "PayPal could not be reached");
    });
    if (response.status >= 500 || response.status === 429) throw new ChargeError(true, `PayPal answered ${response.status}`);
    if (response.status === 404) return null;
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new ChargeError(false, `PayPal refused with ${response.status}`);
    if (typeof body !== "object" || body === null) throw new ChargeError(true, "PayPal sent nothing readable");
    return body as Record<string, unknown>;
  };
  const found = (body: Record<string, unknown> | null): Record<string, unknown> => {
    if (body === null) throw new ChargeError(false, "PayPal has no such resource");
    return body;
  };
  const bearer = async (): Promise<string> => {
    const token = await call("/v1/oauth2/token", {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${wallet.clientId}:${wallet.clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    }).catch(() => {
      // Credentials PayPal refuses mean the pharmacy is not set up yet (merchant:store not run): nothing was charged, so the buyer may ask again.
      throw new ChargeError(true, "PayPal did not sign the pharmacy in");
    });
    if (token === null) throw new ChargeError(true, "PayPal did not sign the pharmacy in");
    if (typeof token["access_token"] !== "string") throw new ChargeError(true, "PayPal sent no access token");
    return `Bearer ${token["access_token"]}`;
  };
  let source: Source | null = null;
  const sourceOf = async (authorization: string): Promise<Source> => {
    if (source !== null) return source;
    const token = found(await call(`/v3/vault/payment-tokens/${encodeURIComponent(wallet.vaultId)}`, { method: "GET", headers: { authorization } }));
    const kinds = typeof token["payment_source"] === "object" && token["payment_source"] !== null ? Object.keys(token["payment_source"]) : [];
    const kind = SOURCES.find((each) => kinds.includes(each));
    if (kind === undefined) throw new ChargeError(false, "The saved payment method is neither a PayPal wallet nor a card");
    source = kind;
    return kind;
  };
  return {
    charge: async ({ key, cents, currency, description }) => {
      const authorization = await bearer();
      const kind = await sourceOf(authorization);
      const amount = decimalAmount({ cents, currency });
      const order = found(
        await call("/v2/checkout/orders", {
          method: "POST",
          headers: { authorization, "content-type": "application/json", "paypal-request-id": key },
          body: JSON.stringify({
            intent: "CAPTURE",
            // The buyer's key rides on the order, so reading it back names the purchase it pays for.
            purchase_units: [{ custom_id: key, description, amount: { currency_code: currency, value: amount } }],
            payment_source: kind === "card" ? { card: { vault_id: wallet.vaultId, stored_credential: { payment_initiator: "MERCHANT", payment_type: "UNSCHEDULED", usage: "SUBSEQUENT" } } } : { paypal: { vault_id: wallet.vaultId } },
          }),
        }),
      );
      const record = paymentRecord(order);
      const capture = record?.capture ?? null;
      if (record === null || capture === null || capture.status !== "COMPLETED" || capture.value !== amount || capture.currency !== currency) {
        throw new ChargeError(false, "PayPal's record does not show this charge completed for this amount");
      }
      return { kind: "paypal", orderId: record.orderId, captureId: capture.id };
    },
    readOrder: async (orderId) => {
      if (!PAYPAL_ORDER_ID.test(orderId)) return null;
      const order = await call(`/v2/checkout/orders/${orderId}`, { method: "GET", headers: { authorization: await bearer() } });
      return order === null ? null : paymentRecord(order);
    },
  };
}

const field = (value: unknown, key: string): unknown => (typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined);
const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : undefined);

/** An order as PayPal sent it, reduced to what decides whether it paid: `null` when it has no ID or status. */
function paymentRecord(order: Record<string, unknown>): PaymentRecord | null {
  const { id: orderId, status } = order;
  if (typeof orderId !== "string" || typeof status !== "string") return null;
  const unit = first(order["purchase_units"]);
  const customId = field(unit, "custom_id");
  const raw = first(field(field(unit, "payments"), "captures"));
  const [id, captureStatus, value, currency] = [field(raw, "id"), field(raw, "status"), field(field(raw, "amount"), "value"), field(field(raw, "amount"), "currency_code")];
  const capture = typeof id === "string" && typeof captureStatus === "string" && typeof value === "string" && typeof currency === "string" ? { id, status: captureStatus, value, currency } : null;
  return { orderId, status, customId: typeof customId === "string" ? customId : null, capture };
}
