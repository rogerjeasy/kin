/**
 * Whether an approved demo payout is paid for real through PayPal's sandbox,
 * to Kin's own sandbox test account, or stays simulated. The money is test
 * money either way; the sandbox path proves the PayPal round trip with a real
 * PayPal batch and item that anyone can look up. Each limit keeps a public
 * demo from draining Kin's sandbox account or being steered elsewhere.
 */

/** The most one sandbox payout may carry: 500.00 in the circle's currency. */
export const SANDBOX_PAYOUT_MAX_CENTS = 50_000;
/** The currency Kin's sandbox business account pays in. */
export const SANDBOX_PAYOUT_CURRENCY = "USD";
/** Real sandbox payouts each demo circle may make: its first, and no more. */
export const SANDBOX_PAYOUTS_PER_CIRCLE = 1;

export type SandboxPayoutFacts = {
  /** Whether a Kin sandbox address is configured at all. */
  readonly configured: boolean;
  readonly kind: "caregiver_payout" | "member_payout";
  /** The proposal reads approved, and at least one member's recorded answer was yes. */
  readonly approved: boolean;
  readonly cents: number;
  readonly currency: string;
  /** Sandbox payouts this circle has already sent to PayPal, this one excluded. */
  readonly circlePayouts: number;
  /** Sandbox payouts started today (UTC) across every demo circle, this one excluded. */
  readonly todayPayouts: number;
  readonly dailyLimit: number;
};

export type SandboxSkipReason = "not_configured" | "not_caregiver" | "not_approved" | "currency" | "over_cap" | "circle_limit" | "daily_limit";

export type SandboxPayoutRoute = { readonly route: "sandbox" } | { readonly route: "simulated"; readonly reason: SandboxSkipReason };

/** Routes one approved demo payout. Every check must pass for the sandbox; otherwise it stays simulated, with the first reason. */
export function routeDemoPayout(facts: SandboxPayoutFacts): SandboxPayoutRoute {
  const reason = firstReason(facts);
  return reason === null ? { route: "sandbox" } : { route: "simulated", reason };
}

function firstReason(facts: SandboxPayoutFacts): SandboxSkipReason | null {
  if (!facts.configured) return "not_configured";
  if (facts.kind !== "caregiver_payout") return "not_caregiver";
  if (!facts.approved) return "not_approved";
  if (facts.currency !== SANDBOX_PAYOUT_CURRENCY) return "currency";
  if (!Number.isSafeInteger(facts.cents) || facts.cents <= 0 || facts.cents > SANDBOX_PAYOUT_MAX_CENTS) return "over_cap";
  if (facts.circlePayouts >= SANDBOX_PAYOUTS_PER_CIRCLE) return "circle_limit";
  if (facts.todayPayouts >= facts.dailyLimit) return "daily_limit";
  return null;
}
