import type { Money } from "./money.ts";

/**
 * The amounts a member may add to the pool in one top-up, in the currency's
 * minor units. The floor keeps PayPal's fixed fee from eating most of a
 * payment; the ceiling keeps a mistyped amount from becoming a large charge.
 */
export const TOP_UP_LIMITS: Readonly<Record<string, { readonly minCents: number; readonly maxCents: number }>> = {
  USD: { minCents: 100, maxCents: 500_000 },
};

export type TopUpCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "currency" | "too_small" | "too_large"; readonly minCents?: number; readonly maxCents?: number };

/** Whether `amount` is one a member may add to the pool in one top-up. */
export function checkTopUp(amount: Money): TopUpCheck {
  const limits = TOP_UP_LIMITS[amount.currency];
  if (limits === undefined) return { ok: false, reason: "currency" };
  if (!Number.isSafeInteger(amount.cents) || amount.cents < limits.minCents) return { ok: false, reason: "too_small", ...limits };
  if (amount.cents > limits.maxCents) return { ok: false, reason: "too_large", ...limits };
  return { ok: true };
}
